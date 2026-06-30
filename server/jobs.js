const { UptimeKumaServer } = require("./uptime-kuma-server");
const { clearOldData } = require("./jobs/clear-old-data");
const { incrementalVacuum } = require("./jobs/incremental-vacuum");
const { loadAndSchedule } = require("./report/report-scheduler");
const { log } = require("../src/util");
const Cron = require("croner");

const jobs = [
    {
        name: "clear-old-data",
        interval: "14 03 * * *",
        jobFunc: clearOldData,
        croner: null,
    },
    {
        name: "incremental-vacuum",
        interval: "*/5 * * * *",
        jobFunc: incrementalVacuum,
        croner: null,
    },
];

/**
 * Initialize background jobs
 * @returns {Promise<void>}
 */
const initBackgroundJobs = async function () {
    const timezone = await UptimeKumaServer.getInstance().getTimezone();

    for (const job of jobs) {
        const cornerJob = new Cron(
            job.interval,
            {
                name: job.name,
                timezone,
            },
            job.jobFunc
        );
        job.croner = cornerJob;
    }

    // Resume persisted SLA report schedules on startup (Requirement 9.2).
    // Isolated so a failure here never blocks other background jobs.
    try {
        await loadAndSchedule();
    } catch (e) {
        log.error("report-scheduler", `Failed to load report schedules: ${e.message}`);
    }
};

/**
 * Stop all background jobs if running
 * @returns {void}
 */
const stopBackgroundJobs = function () {
    for (const job of jobs) {
        if (job.croner) {
            job.croner.stop();
            job.croner = null;
        }
    }
};

module.exports = {
    initBackgroundJobs,
    stopBackgroundJobs,
};
