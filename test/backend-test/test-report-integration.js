const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

const { R } = require("redbean-node");

const UP = 1;
const DOWN = 0;

const testDbPath = path.join(__dirname, "../../data/test-report-integration.db");

/**
 * Insert a monitor row and return its id.
 * @param {string} name Monitor name.
 * @returns {Promise<number>} The new monitor id.
 */
async function insertMonitor(name) {
    await R.exec("INSERT INTO monitor (name) VALUES (?)", [name]);
    const row = await R.getRow("SELECT last_insert_rowid() AS id");
    return row.id;
}

/**
 * Insert a single heartbeat row.
 * @param {number} monitorId Monitor id.
 * @param {number} status Heartbeat status.
 * @param {number} unixSeconds Time in unix seconds.
 * @param {number|null} ping Ping value or null.
 * @returns {Promise<void>}
 */
async function insertHeartbeat(monitorId, status, unixSeconds, ping) {
    const time = dayjs.utc(unixSeconds * 1000).format("YYYY-MM-DD HH:mm:ss.SSS");
    await R.exec("INSERT INTO heartbeat (monitor_id, status, time, ping) VALUES (?, ?, ?, ?)", [
        monitorId,
        status,
        time,
        ping,
    ]);
}

/**
 * Insert an SMTP-type notification row and return its id.
 * @returns {Promise<number>} The new notification id.
 */
async function insertSmtpNotification() {
    const config = JSON.stringify({
        type: "smtp",
        smtpHost: "localhost",
        smtpPort: 25,
        smtpSecure: false,
        smtpFrom: "reports@example.com",
    });
    await R.exec("INSERT INTO notification (name, active, config) VALUES (?, ?, ?)", ["Test SMTP", 1, config]);
    const row = await R.getRow("SELECT last_insert_rowid() AS id");
    return row.id;
}

/**
 * Insert a stat_minutely aggregate row.
 * @param {number} monitorId Monitor id.
 * @param {number} timestamp Unix timestamp (bucket).
 * @param {number} up Up beat count.
 * @param {number} down Down beat count.
 * @param {object} ping Ping fields {avg, min, max}.
 * @returns {Promise<void>}
 */
async function insertStatMinutely(monitorId, timestamp, up, down, ping = {}) {
    await R.exec(
        "INSERT INTO stat_minutely (monitor_id, timestamp, ping, ping_min, ping_max, up, down) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [monitorId, timestamp, ping.avg ?? 0, ping.min ?? 0, ping.max ?? 0, up, down]
    );
}

describe("SLA report integration (real SQLite)", () => {
    before(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        const dir = path.dirname(testDbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const Dialect = require("knex/lib/dialects/sqlite3/index.js");
        Dialect.prototype._driver = () => require("@louislam/sqlite3");

        const knex = require("knex");
        const db = knex({
            client: Dialect,
            connection: { filename: testDbPath },
            useNullAsDefault: true,
        });
        R.setup(db);

        const { createTables } = require("../../db/knex_init_db.js");
        await createTables();
        await R.knex.migrate.latest({
            directory: path.join(__dirname, "../../db/knex_migrations"),
        });
    });

    after(async () => {
        // Stop any cron jobs registered by loadAndSchedule to avoid open handles.
        try {
            const { scheduledJobs } = require("../../server/report/report-scheduler");
            for (const [, job] of scheduledJobs) {
                job.stop();
            }
            scheduledJobs.clear();
        } catch (e) {
            // ignore
        }
        await R.knex.destroy();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    test("generate() produces a Report_Result with availability and response-time series", async () => {
        const { generate } = require("../../server/report/report-generator");
        const monitorId = await insertMonitor("gen-monitor");

        const start = 1705276800; // 2024-01-15 00:00:00 UTC
        const end = start + 3600; // 1 hour window
        await insertHeartbeat(monitorId, UP, start + 100, 50);
        await insertHeartbeat(monitorId, DOWN, start + 1000, null);
        await insertHeartbeat(monitorId, UP, start + 2000, 80);
        await insertHeartbeat(monitorId, UP, start + 3000, 60);

        const result = await generate({ monitorIds: [monitorId], periodType: "custom", start, end });

        assert.strictEqual(result.timeRange.start, start);
        assert.strictEqual(result.timeRange.end, end);
        assert.strictEqual(result.monitors.length, 1);

        const m = result.monitors[0];
        assert.strictEqual(m.monitorId, monitorId);
        // availabilityPercentage is a 2-decimal string when data exists.
        assert.match(m.availabilityPercentage, /^\d+\.\d{2}$/);
        assert.ok(Array.isArray(m.incidents), "incidents should be an array");
        assert.ok(Array.isArray(m.availabilityTimeSeries) && m.availabilityTimeSeries.length > 0);
        assert.ok(
            Object.prototype.hasOwnProperty.call(m.availabilityTimeSeries[0], "availability"),
            "availability series points expose availability"
        );
        assert.ok(Array.isArray(m.responseTimeSeries) && m.responseTimeSeries.length > 0);
        for (const key of ["min", "avg", "max"]) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(m.responseTimeSeries[0], key),
                `response series points expose ${key}`
            );
        }
    });

    // Requirement 7.4: long ranges compute from pre-aggregated stat tables.
    test("generate() uses pre-aggregated stats for long ranges (no raw heartbeats needed)", async () => {
        const { generate } = require("../../server/report/report-generator");
        const monitorId = await insertMonitor("agg-monitor");

        // A 3-day range triggers the aggregated path (> 2 days) and selects stat_minutely.
        const start = 1705000000;
        const end = start + 3 * 24 * 60 * 60;

        // Insert stat rows only — deliberately NO heartbeats for this monitor,
        // so a non-null availability proves the aggregated path was used.
        await insertStatMinutely(monitorId, start + 60, 9, 1, { avg: 30, min: 10, max: 60 });
        await insertStatMinutely(monitorId, start + 120, 10, 0, { avg: 20, min: 8, max: 40 });
        await insertStatMinutely(monitorId, start + 180, 0, 5, {});

        const result = await generate({ monitorIds: [monitorId], periodType: "custom", start, end });
        const m = result.monitors[0];

        // up=19, down=6 → 76.00
        assert.strictEqual(m.availabilityPercentage, "76.00");
        assert.ok(m.responseTime.min === 8 && m.responseTime.max === 60);
        assert.ok(m.incidents.length >= 1, "aggregated path should surface the down bucket as an incident");
        assert.ok(m.availabilityTimeSeries.length >= 1);
    });

    // Requirement 10.3: report generation must not modify existing data.
    test("generate() does not modify heartbeat or monitor data", async () => {
        const { generate } = require("../../server/report/report-generator");
        const monitorId = await insertMonitor("readonly-monitor");
        const start = 1705100000;
        const end = start + 3600;
        await insertHeartbeat(monitorId, UP, start + 100, 50);
        await insertHeartbeat(monitorId, DOWN, start + 1000, null);

        const before = await R.getRow(
            "SELECT (SELECT COUNT(*) FROM heartbeat) AS hb, (SELECT COUNT(*) FROM monitor) AS mon"
        );

        await generate({ monitorIds: [monitorId], periodType: "custom", start, end });

        const after = await R.getRow(
            "SELECT (SELECT COUNT(*) FROM heartbeat) AS hb, (SELECT COUNT(*) FROM monitor) AS mon"
        );
        assert.strictEqual(after.hb, before.hb, "heartbeat row count must be unchanged");
        assert.strictEqual(after.mon, before.mon, "monitor row count must be unchanged");
    });

    // Feature: sla-report-module, Property 10: Schedule 持久化往返
    // Validates: Requirements 5.2, 9.1
    test("Property 10: a saved schedule loads back equivalently", async () => {
        const { saveSchedule, loadSchedule } = require("../../server/report/report-scheduler");
        const mA = await insertMonitor("sch-a");
        const mB = await insertMonitor("sch-b");

        const input = {
            name: "Weekly Roundup",
            cronExpression: "0 0 1 1 *",
            periodType: "weekly",
            exportFormat: "csv",
            recipients: ["a@example.com", "b@example.com"],
            active: true,
            monitorIds: [mA, mB],
        };
        const id = await saveSchedule(input);
        const loaded = await loadSchedule(id);

        assert.strictEqual(loaded.name, input.name);
        assert.strictEqual(loaded.cronExpression, input.cronExpression);
        assert.strictEqual(loaded.periodType, input.periodType);
        assert.strictEqual(loaded.exportFormat, input.exportFormat);
        assert.deepStrictEqual(loaded.recipients, input.recipients);
        assert.deepStrictEqual(new Set(loaded.monitorIds), new Set(input.monitorIds));
    });

    // Feature: sla-report-module, Property 12: 无 SMTP 配置时拒绝启用邮件的 Schedule
    // Validates: Requirements 5.7
    test("Property 12: enabling email without a valid SMTP notification is rejected", async () => {
        const { saveSchedule } = require("../../server/report/report-scheduler");

        await assert.rejects(
            () =>
                saveSchedule({
                    name: "No SMTP",
                    cronExpression: "0 0 1 1 *",
                    periodType: "daily",
                    exportFormat: "pdf",
                    recipients: ["x@example.com"],
                    active: true,
                    emailEnabled: true,
                    smtpNotificationId: null,
                    monitorIds: [],
                }),
            /smtpNotConfigured/
        );

        await assert.rejects(
            () =>
                saveSchedule({
                    name: "Bad SMTP id",
                    cronExpression: "0 0 1 1 *",
                    periodType: "daily",
                    exportFormat: "pdf",
                    recipients: ["x@example.com"],
                    active: true,
                    emailEnabled: true,
                    smtpNotificationId: 999999,
                    monitorIds: [],
                }),
            /smtpNotConfigured/
        );
    });

    // Feature: sla-report-module, Property 11: 禁用的 Schedule 不生成报告
    // Validates: Requirements 5.5
    test("Property 11: a disabled schedule is skipped and produces no run log", async () => {
        const { saveSchedule, runSchedule } = require("../../server/report/report-scheduler");
        const id = await saveSchedule({
            name: "Disabled",
            cronExpression: "0 0 1 1 *",
            periodType: "daily",
            exportFormat: "csv",
            recipients: [],
            active: false,
            monitorIds: [],
        });

        const loaded = { id, active: false, periodType: "daily", monitorIds: [], exportFormat: "csv" };
        await runSchedule(loaded);

        const logs = await R.getAll("SELECT * FROM report_run_log WHERE schedule_id = ?", [id]);
        assert.strictEqual(logs.length, 0, "disabled schedule should not write a run log");
    });

    // Feature: sla-report-module, Property 15: 调度运行的错误隔离
    // Validates: Requirements 10.2
    test("Property 15: a failing schedule run is logged as failed and never throws", async () => {
        const { saveSchedule, runSchedule } = require("../../server/report/report-scheduler");
        const id = await saveSchedule({
            name: "Will Fail",
            cronExpression: "0 0 1 1 *",
            periodType: "daily",
            exportFormat: "csv",
            recipients: [],
            active: true,
            monitorIds: [],
        });

        // monitorIds references a non-existent monitor → generate throws → must be isolated.
        const failing = {
            id,
            active: true,
            periodType: "daily",
            exportFormat: "csv",
            monitorIds: [999999],
        };

        await assert.doesNotReject(() => runSchedule(failing));

        const logs = await R.getAll("SELECT * FROM report_run_log WHERE schedule_id = ? AND status = ?", [
            id,
            "failed",
        ]);
        assert.ok(logs.length >= 1, "a failed run log should be recorded");
    });

    // 16.2: startup recovery — loadAndSchedule registers active schedules only.
    test("loadAndSchedule registers active schedules and skips disabled ones", async () => {
        const { saveSchedule, loadAndSchedule, scheduledJobs } = require("../../server/report/report-scheduler");

        const activeId = await saveSchedule({
            name: "Active Sched",
            cronExpression: "0 0 1 1 *",
            periodType: "daily",
            exportFormat: "csv",
            recipients: [],
            active: true,
            monitorIds: [],
        });
        const inactiveId = await saveSchedule({
            name: "Inactive Sched",
            cronExpression: "0 0 1 1 *",
            periodType: "daily",
            exportFormat: "csv",
            recipients: [],
            active: false,
            monitorIds: [],
        });

        await loadAndSchedule();

        assert.ok(scheduledJobs.has(activeId), "active schedule should be registered");
        assert.ok(!scheduledJobs.has(inactiveId), "inactive schedule should not be registered");

        // Cleanup registered jobs.
        for (const [, job] of scheduledJobs) {
            job.stop();
        }
        scheduledJobs.clear();
    });

    // 16.3: scheduled run end-to-end with a mocked nodemailer transporter.
    test("runSchedule generates, exports and delivers via SMTP (mocked), logging success", async () => {
        const nodemailer = require("nodemailer");
        const originalCreateTransport = nodemailer.createTransport;
        const sent = [];
        nodemailer.createTransport = () => ({
            sendMail: async (opts) => {
                sent.push(opts);
                return { messageId: "mock" };
            },
        });

        try {
            const { saveSchedule, runSchedule } = require("../../server/report/report-scheduler");

            const monitorId = await insertMonitor("scheduled-monitor");
            const now = dayjs.utc().unix();
            await insertHeartbeat(monitorId, UP, now - 600, 40);
            await insertHeartbeat(monitorId, UP, now - 300, 55);

            const smtpId = await insertSmtpNotification();

            const id = await saveSchedule({
                name: "Daily Email",
                cronExpression: "0 0 1 1 *",
                periodType: "daily",
                exportFormat: "csv",
                recipients: ["ops@example.com"],
                active: true,
                emailEnabled: true,
                smtpNotificationId: smtpId,
                monitorIds: [monitorId],
            });

            const schedule = {
                id,
                active: true,
                periodType: "daily",
                exportFormat: "csv",
                recipients: ["ops@example.com"],
                smtpNotificationId: smtpId,
                monitorIds: [monitorId],
                name: "Daily Email",
            };

            await runSchedule(schedule);

            assert.strictEqual(sent.length, 1, "exactly one email should be sent");
            assert.ok(sent[0].attachments && sent[0].attachments.length === 1, "email should carry one attachment");
            assert.ok(sent[0].attachments[0].filename.endsWith(".csv"), "attachment should be the CSV report");

            const logs = await R.getAll("SELECT * FROM report_run_log WHERE schedule_id = ? AND status = ?", [
                id,
                "success",
            ]);
            assert.ok(logs.length >= 1, "a success run log should be recorded");
        } finally {
            nodemailer.createTransport = originalCreateTransport;
        }
    });

    // 16.6: performance — generate() returns within 10s for ~100k heartbeats.
    test("generate() returns within 10s for ~100k heartbeats", async () => {
        const monitorId = await insertMonitor("perf-monitor");
        const start = 1700000000;
        const count = 100000;
        const stepSeconds = 30;
        const end = start + count * stepSeconds;

        // Batch insert heartbeats for speed. SQLite caps compound SELECT terms
        // (~500), so keep the per-insert chunk well below that.
        const chunkSize = 100;
        let rows = [];
        for (let i = 0; i < count; i++) {
            const t = dayjs.utc((start + i * stepSeconds) * 1000).format("YYYY-MM-DD HH:mm:ss.SSS");
            rows.push({
                monitor_id: monitorId,
                status: i % 50 === 0 ? DOWN : UP,
                time: t,
                ping: 20 + (i % 100),
            });
            if (rows.length >= chunkSize) {
                await R.knex.batchInsert("heartbeat", rows, chunkSize);
                rows = [];
            }
        }
        if (rows.length > 0) {
            await R.knex.batchInsert("heartbeat", rows, chunkSize);
        }

        const { generate } = require("../../server/report/report-generator");
        const t0 = Date.now();
        const result = await generate({ monitorIds: [monitorId], periodType: "custom", start, end });
        const elapsed = Date.now() - t0;

        assert.ok(result.monitors.length === 1, "should produce one monitor result");
        assert.ok(elapsed < 10000, `generate should finish within 10s (took ${elapsed}ms)`);
    });
});

describe("report-data-access source selection thresholds", () => {
    test("shouldUseAggregatedStats switches on a 2-day range boundary", () => {
        const { shouldUseAggregatedStats } = require("../../server/report/report-data-access");
        const twoDays = 2 * 24 * 60 * 60;
        const base = 1700000000;
        assert.strictEqual(shouldUseAggregatedStats({ start: base, end: base + twoDays }), false);
        assert.strictEqual(shouldUseAggregatedStats({ start: base, end: base + twoDays + 1 }), true);
    });
});
