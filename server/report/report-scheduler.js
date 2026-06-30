/**
 * Report scheduler module.
 * Manages periodic report generation and email delivery using croner.
 * Runs in the background job process (server/jobs/) to avoid blocking monitoring.
 * @module server/report/report-scheduler
 */

const { R } = require("redbean-node");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
const Cron = require("croner");
const nodemailer = require("nodemailer");

const { SQL_DATETIME_FORMAT } = require("../../src/util");
const { generate } = require("./report-generator");
const { exportPdf, exportCsv } = require("./report-exporter");

/** @type {Map<number, import("croner").CronJob>} Active cron jobs keyed by schedule ID */
const scheduledJobs = new Map();

/**
 * Validate a schedule before saving.
 * When email delivery is enabled, verifies that a valid SMTP notification is
 * selected and exists in the system (Requirement 5.7). When email is not enabled,
 * any provided smtp_notification_id is still validated for consistency.
 * @param {object} schedule The schedule object to validate.
 * @param {boolean} schedule.emailEnabled Whether email delivery is enabled.
 * @param {number|null} schedule.smtpNotificationId SMTP notification config id.
 * @throws {Error} Throws with message "smtpNotConfigured" if email delivery is
 *     enabled but no valid SMTP notification exists.
 * @returns {Promise<void>}
 */
async function validateScheduleSave(schedule) {
    // Requirement 5.7: enabling email delivery requires a configured SMTP channel.
    if (schedule.emailEnabled && !schedule.smtpNotificationId) {
        throw new Error("smtpNotConfigured");
    }

    if (schedule.smtpNotificationId) {
        const rows = await R.getAll("SELECT id, config FROM notification WHERE id = ?", [schedule.smtpNotificationId]);

        if (rows.length === 0) {
            throw new Error("smtpNotConfigured");
        }

        // Verify the notification is actually an SMTP type
        try {
            const config = JSON.parse(rows[0].config);
            if (config.type !== "smtp") {
                throw new Error("smtpNotConfigured");
            }
        } catch (e) {
            if (e.message === "smtpNotConfigured") {
                throw e;
            }
            // Malformed config JSON also means invalid SMTP channel
            throw new Error("smtpNotConfigured");
        }
    }
}

/**
 * Save (insert or update) a schedule with its associated monitor IDs.
 * On insert, sets created_date; on update, sets updated_date.
 * Syncs report_schedule_monitor entries by deleting existing and re-inserting.
 * Validates SMTP configuration before persisting when email delivery is enabled.
 * @param {object} schedule The schedule object to persist.
 * @param {string} schedule.name Schedule name.
 * @param {string} schedule.cronExpression Cron expression string.
 * @param {string} schedule.periodType One of daily/weekly/monthly/custom.
 * @param {string} schedule.exportFormat One of pdf/csv.
 * @param {string[]|string} schedule.recipients Array of email recipients (or JSON string).
 * @param {number|null} schedule.smtpNotificationId SMTP notification config id.
 * @param {boolean} schedule.active Whether the schedule is enabled.
 * @param {number[]} schedule.monitorIds Array of monitor IDs.
 * @param {number} schedule.id If present, performs an update instead of insert.
 * @returns {Promise<number>} The schedule ID.
 * @throws {Error} Throws with message "smtpNotConfigured" if SMTP validation fails.
 */
async function saveSchedule(schedule) {
    // Validate SMTP configuration before persisting
    await validateScheduleSave(schedule);
    const recipientsJson = Array.isArray(schedule.recipients)
        ? JSON.stringify(schedule.recipients)
        : schedule.recipients;

    const active = schedule.active !== undefined ? (schedule.active ? 1 : 0) : 1;
    const now = dayjs.utc().format(SQL_DATETIME_FORMAT);

    let scheduleId;

    if (schedule.id) {
        // UPDATE existing schedule
        await R.exec(
            `UPDATE report_schedule
             SET name = ?, cron_expression = ?, period_type = ?, export_format = ?,
                 recipients = ?, smtp_notification_id = ?, active = ?, updated_date = ?
             WHERE id = ?`,
            [
                schedule.name,
                schedule.cronExpression,
                schedule.periodType,
                schedule.exportFormat,
                recipientsJson,
                schedule.smtpNotificationId || null,
                active,
                now,
                schedule.id,
            ]
        );
        scheduleId = schedule.id;
    } else {
        // INSERT new schedule
        await R.exec(
            `INSERT INTO report_schedule
             (name, cron_expression, period_type, export_format, recipients, smtp_notification_id, active, created_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                schedule.name,
                schedule.cronExpression,
                schedule.periodType,
                schedule.exportFormat,
                recipientsJson,
                schedule.smtpNotificationId || null,
                active,
                now,
            ]
        );

        // Retrieve the last inserted id
        const row = await R.getRow("SELECT last_insert_rowid() AS id");
        scheduleId = row.id;
    }

    // Sync monitor associations: delete existing then re-insert
    await R.exec("DELETE FROM report_schedule_monitor WHERE schedule_id = ?", [scheduleId]);

    const monitorIds = schedule.monitorIds || [];
    for (const monitorId of monitorIds) {
        await R.exec("INSERT INTO report_schedule_monitor (schedule_id, monitor_id) VALUES (?, ?)", [
            scheduleId,
            monitorId,
        ]);
    }

    return scheduleId;
}

/**
 * Load a single schedule by ID, including its associated monitor IDs.
 * @param {number} scheduleId The schedule ID to load.
 * @returns {Promise<object|null>} The schedule object with monitorIds array, or null if not found.
 */
async function loadSchedule(scheduleId) {
    const row = await R.getRow("SELECT * FROM report_schedule WHERE id = ?", [scheduleId]);

    if (!row) {
        return null;
    }

    const monitorRows = await R.getAll("SELECT monitor_id FROM report_schedule_monitor WHERE schedule_id = ?", [
        scheduleId,
    ]);

    return mapRowToSchedule(row, monitorRows);
}

/**
 * Load all schedules with their associated monitor IDs.
 * @returns {Promise<object[]>} Array of schedule objects, each with a monitorIds array.
 */
async function listSchedules() {
    const rows = await R.getAll("SELECT * FROM report_schedule ORDER BY id ASC");

    const schedules = [];
    for (const row of rows) {
        const monitorRows = await R.getAll("SELECT monitor_id FROM report_schedule_monitor WHERE schedule_id = ?", [
            row.id,
        ]);
        schedules.push(mapRowToSchedule(row, monitorRows));
    }

    return schedules;
}

/**
 * Delete a schedule and its monitor associations.
 * @param {number} scheduleId The schedule ID to delete.
 * @returns {Promise<void>}
 */
async function deleteSchedule(scheduleId) {
    await R.exec("DELETE FROM report_schedule_monitor WHERE schedule_id = ?", [scheduleId]);
    await R.exec("DELETE FROM report_schedule WHERE id = ?", [scheduleId]);
}

/**
 * Write a run log entry for a schedule execution.
 * @param {number} scheduleId The schedule ID.
 * @param {string} status Run status: "success" or "failed".
 * @param {string|null} message Failure reason or null for success.
 * @returns {Promise<void>}
 */
async function logRun(scheduleId, status, message) {
    const now = dayjs.utc().format(SQL_DATETIME_FORMAT);
    await R.exec("INSERT INTO report_run_log (schedule_id, status, message, run_time) VALUES (?, ?, ?, ?)", [
        scheduleId,
        status,
        message || null,
        now,
    ]);
}

/**
 * Map a database row and its monitor association rows to a schedule object.
 * Parses recipients from JSON string to array.
 * @param {object} row The report_schedule row.
 * @param {object[]} monitorRows The report_schedule_monitor rows.
 * @returns {object} The schedule domain object.
 */
function mapRowToSchedule(row, monitorRows) {
    let recipients;
    try {
        recipients = JSON.parse(row.recipients);
    } catch (e) {
        recipients = [];
    }

    return {
        id: row.id,
        name: row.name,
        cronExpression: row.cron_expression,
        periodType: row.period_type,
        exportFormat: row.export_format,
        recipients: recipients,
        smtpNotificationId: row.smtp_notification_id || null,
        active: !!row.active,
        monitorIds: monitorRows.map((r) => r.monitor_id),
        createdDate: row.created_date || null,
        updatedDate: row.updated_date || null,
    };
}

/**
 * Load persisted schedules and (re)register croner jobs on startup.
 * Reads active schedules from report_schedule table and registers cron jobs.
 * Each schedule is registered independently; a single failure does not block others.
 * @returns {Promise<void>} Resolves once all active schedules are scheduled.
 */
async function loadAndSchedule() {
    // Stop and clear any existing jobs
    for (const [, job] of scheduledJobs) {
        job.stop();
    }
    scheduledJobs.clear();

    // Load all schedules from the database
    const schedules = await listSchedules();

    for (const schedule of schedules) {
        if (!schedule.active) {
            continue;
        }

        try {
            const job = new Cron(schedule.cronExpression, async () => {
                await runSchedule(schedule);
            });
            scheduledJobs.set(schedule.id, job);
        } catch (err) {
            // Registration failure (e.g. invalid cron expression) is isolated per schedule
            await logRun(schedule.id, "failed", `Failed to register cron: ${err.message}`);
        }
    }
}

/**
 * Execute a single schedule: generate, export, deliver, log.
 * Skips disabled schedules; isolates failures per schedule.
 * Uses stored SMTP notification config to build nodemailer transporter for attachments.
 * @param {object} schedule The persisted schedule.
 * @returns {Promise<void>} Always resolves; failures are logged, not thrown.
 */
async function runSchedule(schedule) {
    // Skip disabled schedules
    if (!schedule.active) {
        return;
    }

    try {
        // 1. Build report request from schedule
        const request = {
            monitorIds: schedule.monitorIds,
            periodType: schedule.periodType,
            referenceDate: Math.floor(Date.now() / 1000),
        };

        // 2. Generate report
        const reportResult = await generate(request);

        // 3. Export in the specified format
        const exporter = schedule.exportFormat === "pdf" ? exportPdf : exportCsv;
        const { fileName, buffer } = await exporter(reportResult);

        // 4. Send email with attachment using stored SMTP config
        await sendReportEmail(schedule, fileName, buffer);

        // 5. Log success
        await logRun(schedule.id, "success", null);
    } catch (err) {
        // Log failure but preserve the schedule (never throw)
        await logRun(schedule.id, "failed", err.message || String(err));
    }
}

/**
 * Send a report email with the exported file as attachment.
 * Loads SMTP configuration from the notification table and builds a nodemailer transporter.
 * @param {object} schedule The schedule containing recipients and smtpNotificationId.
 * @param {string} fileName The attachment file name.
 * @param {Buffer} buffer The attachment content buffer.
 * @returns {Promise<void>}
 * @throws {Error} Throws if SMTP config is missing or email delivery fails.
 */
async function sendReportEmail(schedule, fileName, buffer) {
    if (!schedule.smtpNotificationId) {
        throw new Error("No SMTP notification configured for this schedule");
    }

    // Load SMTP notification config from the database
    const row = await R.getRow("SELECT config FROM notification WHERE id = ?", [schedule.smtpNotificationId]);
    if (!row) {
        throw new Error("SMTP notification not found");
    }

    const notification = JSON.parse(row.config);

    // Build nodemailer transporter config (mirrors server/notification-providers/smtp.js)
    const transportConfig = {
        host: notification.smtpHost,
        port: notification.smtpPort,
        secure: notification.smtpSecure,
    };

    if (!notification.smtpSecure && notification.smtpIgnoreSTARTTLS) {
        transportConfig.ignoreTLS = true;
    } else {
        transportConfig.tls = {
            rejectUnauthorized: !notification.smtpIgnoreTLSError || false,
        };
    }

    if (notification.smtpUsername || notification.smtpPassword) {
        transportConfig.auth = {
            user: notification.smtpUsername,
            pass: notification.smtpPassword,
        };
    }

    const transporter = nodemailer.createTransport(transportConfig);

    // Determine recipients list
    const recipients = Array.isArray(schedule.recipients) ? schedule.recipients.join(", ") : schedule.recipients;

    // Send email with the report as attachment
    await transporter.sendMail({
        from: notification.smtpFrom,
        to: recipients,
        subject: `SLA Report: ${schedule.name}`,
        text: `Please find the attached SLA report "${schedule.name}" generated at ${dayjs.utc().format("YYYY-MM-DD HH:mm:ss")} UTC.`,
        attachments: [
            {
                filename: fileName,
                content: buffer,
            },
        ],
    });
}

module.exports = {
    loadAndSchedule,
    runSchedule,
    saveSchedule,
    loadSchedule,
    listSchedules,
    deleteSchedule,
    logRun,
    validateScheduleSave,
    scheduledJobs,
};
