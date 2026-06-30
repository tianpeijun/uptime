/**
 * Database access layer for SLA report data retrieval.
 * Read-only queries against heartbeat and pre-aggregated stat tables.
 * All queries use monitor_id + time indexed columns.
 * @module server/report/report-data-access
 */

const { R } = require("redbean-node");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

/**
 * Fetch raw heartbeats for a monitor within a time range, using indexed columns.
 * @param {number} monitorId The monitor id.
 * @param {{start:number, end:number}} range The Time_Range (Unix seconds).
 * @returns {Promise<Array<object>>} Heartbeat rows ordered by time ascending.
 */
async function fetchHeartbeats(monitorId, range) {
    const startTime = dayjs.utc(range.start * 1000).format("YYYY-MM-DD HH:mm:ss.SSS");
    const endTime = dayjs.utc(range.end * 1000).format("YYYY-MM-DD HH:mm:ss.SSS");

    return await R.getAll(
        "SELECT * FROM heartbeat WHERE monitor_id = ? AND time >= ? AND time <= ? ORDER BY time ASC",
        [monitorId, startTime, endTime]
    );
}

/**
 * Determine which pre-aggregated stat table to use based on range duration.
 * - Range > 90 days → stat_daily
 * - Range > 7 days → stat_hourly
 * - Otherwise → stat_minutely
 * @param {{start:number, end:number}} range The Time_Range (Unix seconds).
 * @returns {string} The stat table name to query.
 */
function selectStatTable(range) {
    const durationSeconds = range.end - range.start;
    const NINETY_DAYS = 90 * 24 * 60 * 60;
    const SEVEN_DAYS = 7 * 24 * 60 * 60;

    if (durationSeconds > NINETY_DAYS) {
        return "stat_daily";
    } else if (durationSeconds > SEVEN_DAYS) {
        return "stat_hourly";
    }
    return "stat_minutely";
}

/**
 * Fetch pre-aggregated stats for long ranges (stat_daily/hourly/minutely).
 * Selects the appropriate stat table based on range duration.
 * Used when the time range exceeds the threshold for raw heartbeat queries.
 * @param {number} monitorId The monitor id.
 * @param {{start:number, end:number}} range The Time_Range (Unix seconds).
 * @returns {Promise<Array<object>>} Aggregated stat rows ordered by timestamp ascending.
 */
async function fetchAggregatedStats(monitorId, range) {
    const table = selectStatTable(range);

    return await R.getAll(
        `SELECT * FROM ${table} WHERE monitor_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`,
        [monitorId, range.start, range.end]
    );
}

/**
 * Determine whether pre-aggregated stats should be used instead of raw heartbeats.
 * For ranges exceeding 2 days (172800 seconds), aggregated stats provide better
 * query performance at the cost of less precise incident boundaries.
 * @param {{start:number, end:number}} range The Time_Range (Unix seconds).
 * @returns {boolean} True if aggregated stats should be used.
 */
function shouldUseAggregatedStats(range) {
    const TWO_DAYS = 2 * 24 * 60 * 60;
    const durationSeconds = range.end - range.start;
    return durationSeconds > TWO_DAYS;
}

/**
 * Get the duration in seconds of a single bucket for a given stat table.
 * @param {string} table The stat table name.
 * @returns {number} Bucket duration in seconds.
 */
function getStatBucketSeconds(table) {
    if (table === "stat_daily") {
        return 24 * 60 * 60;
    } else if (table === "stat_hourly") {
        return 60 * 60;
    }
    return 60;
}

module.exports = {
    fetchHeartbeats,
    fetchAggregatedStats,
    shouldUseAggregatedStats,
    selectStatTable,
    getStatBucketSeconds,
};
