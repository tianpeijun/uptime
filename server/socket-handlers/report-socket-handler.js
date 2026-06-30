const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");
const { generate } = require("../report/report-generator");
const { exportPdf, exportCsv } = require("../report/report-exporter");
const { saveSchedule, loadSchedule, listSchedules, deleteSchedule } = require("../report/report-scheduler");

/**
 * Socket.IO handlers for the SLA Report Module.
 * Exposes report generation, export, and schedule CRUD events.
 * All handlers require authentication via checkLogin.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.reportSocketHandler = (socket) => {
    // Generate a report on demand
    socket.on("generateReport", async (reportRequest, callback) => {
        try {
            checkLogin(socket);
            const reportResult = await generate(reportRequest);
            callback({
                ok: true,
                reportResult,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Export a report as PDF or CSV
    socket.on("exportReport", async ({ reportRequest, format }, callback) => {
        try {
            checkLogin(socket);
            const reportResult = await generate(reportRequest);
            const exporter = format === "pdf" ? exportPdf : exportCsv;
            const { fileName, buffer } = await exporter(reportResult);
            callback({
                ok: true,
                fileName,
                base64: buffer.toString("base64"),
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // List all report schedules
    socket.on("getReportSchedules", async (callback) => {
        try {
            checkLogin(socket);
            const schedules = await listSchedules();
            callback({
                ok: true,
                schedules,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Get a single report schedule by ID
    socket.on("getReportSchedule", async (scheduleId, callback) => {
        try {
            checkLogin(socket);
            const schedule = await loadSchedule(scheduleId);
            if (!schedule) {
                throw new Error("Schedule not found");
            }
            callback({
                ok: true,
                schedule,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Create a new report schedule
    socket.on("addReportSchedule", async (schedule, callback) => {
        try {
            checkLogin(socket);
            const scheduleId = await saveSchedule(schedule);
            callback({
                ok: true,
                scheduleId,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Edit an existing report schedule
    socket.on("editReportSchedule", async (scheduleId, schedule, callback) => {
        try {
            checkLogin(socket);
            schedule.id = scheduleId;
            await saveSchedule(schedule);
            callback({
                ok: true,
                msg: "Saved.",
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Delete a report schedule
    socket.on("deleteReportSchedule", async (scheduleId, callback) => {
        try {
            checkLogin(socket);
            await deleteSchedule(scheduleId);
            callback({
                ok: true,
                msg: "Deleted.",
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Get run logs for a specific schedule
    socket.on("getReportRunLogs", async (scheduleId, callback) => {
        try {
            checkLogin(socket);
            const logs = await R.getAll("SELECT * FROM report_run_log WHERE schedule_id = ? ORDER BY run_time DESC", [
                scheduleId,
            ]);
            callback({
                ok: true,
                logs,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
