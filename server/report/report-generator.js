/**
 * Report generator orchestration module.
 * Validates Report_Request, resolves Time_Range, selects data source,
 * invokes the pure-function metrics layer, and assembles Report_Result.
 * @module server/report/report-generator
 */

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const isoWeek = require("dayjs/plugin/isoWeek");
const { R } = require("redbean-node");

const { fetchHeartbeats, fetchAggregatedStats, shouldUseAggregatedStats, selectStatTable, getStatBucketSeconds } = require("./report-data-access");
const {
    calculateAvailability,
    calculateAvailabilityTimeSeries,
    calculateUptimeDowntime,
    detectIncidents,
    calculateMTTR,
    calculateResponseTimeStats,
    calculateResponseTimeSeries,
    formatPercentage,
    calculateAggregatedAvailability,
    estimateAggregatedUptimeDowntime,
    calculateAggregatedResponseTimeStats,
    calculateAggregatedAvailabilityTimeSeries,
    calculateAggregatedResponseTimeSeries,
    detectAggregatedIncidents,
} = require("./report-metrics");

dayjs.extend(utc);
dayjs.extend(isoWeek);

/** Valid period type enum values */
const VALID_PERIOD_TYPES = ["daily", "weekly", "monthly", "custom"];

/**
 * Resolve a concrete Time_Range from a Report_Request.
 * For daily/weekly/monthly, derive from periodType + referenceDate.
 * For custom, use the explicit start/end.
 * @param {object} request The Report_Request.
 * @returns {{start: number, end: number}} Unix-second bounds.
 * @throws {Error} If the range is invalid (start > end) or custom bounds missing.
 */
function resolveTimeRange(request) {
    const { periodType, referenceDate, start, end } = request;
    let rangeStart;
    let rangeEnd;

    switch (periodType) {
        case "daily": {
            const ref = dayjs.unix(referenceDate).utc();
            rangeStart = ref.startOf("day").unix();
            rangeEnd = ref.endOf("day").unix();
            break;
        }
        case "weekly": {
            const ref = dayjs.unix(referenceDate).utc();
            rangeStart = ref.startOf("isoWeek").unix();
            rangeEnd = ref.endOf("isoWeek").unix();
            break;
        }
        case "monthly": {
            const ref = dayjs.unix(referenceDate).utc();
            rangeStart = ref.startOf("month").unix();
            rangeEnd = ref.endOf("month").unix();
            break;
        }
        case "custom": {
            if (start == null || end == null) {
                throw new Error("Custom period requires start and end");
            }
            rangeStart = start;
            rangeEnd = end;
            break;
        }
        default:
            throw new Error(`Invalid periodType: ${periodType}`);
    }

    if (rangeStart > rangeEnd) {
        throw new Error("Start time must not be after end time");
    }

    return { start: rangeStart, end: rangeEnd };
}

/**
 * Validate a Report_Request before processing.
 * Checks in order:
 * 1. periodType is a valid enum value
 * 2. custom period has start/end (delegated to resolveTimeRange)
 * 3. start <= end (delegated to resolveTimeRange)
 * 4. monitorIds is a non-empty array
 * 5. Every monitorId exists in the monitor table
 *
 * Throws an error with an i18n-friendly message key on failure.
 * Does not touch monitor operation.
 * @param {object} request The Report_Request to validate.
 * @returns {Promise<{start: number, end: number}>} The resolved time range on success.
 * @throws {Error} Validation error with message key.
 */
async function validateReportRequest(request) {
    const { periodType, monitorIds } = request;

    // 1. Validate periodType enum
    if (!VALID_PERIOD_TYPES.includes(periodType)) {
        const err = new Error("invalidPeriodType");
        err.details = { periodType };
        throw err;
    }

    // 2 & 3. Resolve time range (handles custom start/end requirement and start > end)
    const timeRange = resolveTimeRange(request);

    // 4. Validate monitorIds is a non-empty array
    if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
        throw new Error("atLeastOneMonitorRequired");
    }

    // 5. Verify each monitorId exists in the database
    const missingIds = [];
    for (const id of monitorIds) {
        const monitor = await R.findOne("monitor", " id = ? ", [id]);
        if (!monitor) {
            missingIds.push(id);
        }
    }

    if (missingIds.length > 0) {
        const err = new Error("monitorNotFound");
        err.details = { missingIds };
        throw err;
    }

    return timeRange;
}

/**
 * Generate a Report_Result for one or more monitors.
 * Orchestrates: validate -> fetch -> compute -> assemble.
 * All monitors share the same Time_Range resolved from the request.
 * Missing data is expressed as null (not zero) per design.
 * @param {object} request The Report_Request.
 * @returns {Promise<object>} The Report_Result.
 */
async function generate(request) {
    // 1. Validate the request and resolve Time_Range
    const timeRange = await validateReportRequest(request);

    // 2. For each monitorId, fetch data and compute metrics.
    // Long ranges use pre-aggregated stat tables (Requirement 7.4) to avoid
    // scanning huge raw heartbeat sets; shorter ranges use raw heartbeats for
    // precise incident boundaries.
    const monitors = [];
    const useAggregated = shouldUseAggregatedStats(timeRange);

    for (const monitorId of request.monitorIds) {
        let monitorResult;

        if (useAggregated) {
            monitorResult = await computeFromAggregatedStats(monitorId, timeRange);
        } else {
            monitorResult = await computeFromRawHeartbeats(monitorId, timeRange);
        }

        monitors.push(monitorResult);
    }

    // 3. Assemble Report_Result
    return {
        timeRange,
        generatedAt: Math.floor(Date.now() / 1000),
        monitors,
    };
}

/**
 * Compute a monitor's report metrics from raw heartbeats (precise path).
 * @param {number} monitorId The monitor id.
 * @param {{start:number, end:number}} timeRange The Time_Range.
 * @returns {Promise<object>} The per-monitor Report_Result entry.
 */
async function computeFromRawHeartbeats(monitorId, timeRange) {
    const beats = await fetchHeartbeats(monitorId, timeRange);

    const availability = calculateAvailability(beats, timeRange);
    const availabilityTimeSeries = calculateAvailabilityTimeSeries(beats, timeRange);
    const { uptimeSeconds, downtimeSeconds } = calculateUptimeDowntime(beats, timeRange);
    const incidents = detectIncidents(beats);
    const mttr = calculateMTTR(incidents);
    const responseTime = calculateResponseTimeStats(beats);
    const responseTimeSeries = calculateResponseTimeSeries(beats, timeRange);

    return {
        monitorId,
        availabilityPercentage: formatPercentage(availability),
        uptimeSeconds,
        downtimeSeconds,
        incidentCount: availability === null ? null : incidents.length,
        mttrSeconds: mttr,
        responseTime,
        incidents,
        availabilityTimeSeries,
        responseTimeSeries,
    };
}

/**
 * Compute a monitor's report metrics from pre-aggregated stat rows (long-range path).
 * Availability, response time and per-bucket series are derived from the stat table;
 * uptime/downtime are estimated from the up/down ratio, and incidents are approximate
 * at the bucket granularity.
 * @param {number} monitorId The monitor id.
 * @param {{start:number, end:number}} timeRange The Time_Range.
 * @returns {Promise<object>} The per-monitor Report_Result entry.
 */
async function computeFromAggregatedStats(monitorId, timeRange) {
    const statRows = await fetchAggregatedStats(monitorId, timeRange);
    const bucketSeconds = getStatBucketSeconds(selectStatTable(timeRange));

    const availability = calculateAggregatedAvailability(statRows);
    const availabilityTimeSeries = calculateAggregatedAvailabilityTimeSeries(statRows);
    const { uptimeSeconds, downtimeSeconds } = estimateAggregatedUptimeDowntime(statRows, timeRange);
    const incidents = detectAggregatedIncidents(statRows, bucketSeconds);
    const mttr = calculateMTTR(incidents);
    const responseTime = calculateAggregatedResponseTimeStats(statRows);
    const responseTimeSeries = calculateAggregatedResponseTimeSeries(statRows);

    return {
        monitorId,
        availabilityPercentage: formatPercentage(availability),
        uptimeSeconds,
        downtimeSeconds,
        incidentCount: availability === null ? null : incidents.length,
        mttrSeconds: mttr,
        responseTime,
        incidents,
        availabilityTimeSeries,
        responseTimeSeries,
    };
}

module.exports = {
    resolveTimeRange,
    validateReportRequest,
    generate,
};
