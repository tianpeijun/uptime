/**
 * Pure-function metrics layer for SLA report generation.
 * No I/O or database access — all computations are deterministic given inputs.
 * Suitable for property-based testing.
 * @module server/report/report-metrics
 */

const { DOWN, UP, PENDING, MAINTENANCE } = require("../../src/util");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

/**
 * Compute availability percentage over a time range, excluding MAINTENANCE time.
 * up / (up + down); MAINTENANCE intervals are removed from the denominator.
 * PENDING beats (status=2) are counted as UP for availability.
 * @param {Array<object>} beats Heartbeat-like records sorted by time ascending.
 * @param {{start:number, end:number}} range The Time_Range.
 * @returns {number|null} Percentage rounded to 2 decimals, or null when no data.
 */
function calculateAvailability(beats, range) {
    if (!beats || beats.length === 0) {
        return null;
    }

    let upCount = 0;
    let downCount = 0;

    for (const beat of beats) {
        if (beat.status === MAINTENANCE) {
            // Exclude MAINTENANCE from both numerator and denominator
            continue;
        }
        if (beat.status === UP || beat.status === PENDING) {
            upCount++;
        } else if (beat.status === DOWN) {
            downCount++;
        }
    }

    const total = upCount + downCount;

    // No non-MAINTENANCE heartbeats means no monitored data
    if (total === 0) {
        return null;
    }

    const percentage = (upCount / total) * 100;
    return Math.round(percentage * 100) / 100;
}

/**
 * Build an availability time series by bucketing beats across the time range.
 * Each bucket's availability is computed with calculateAvailability over the
 * beats whose timestamp falls inside the bucket. Buckets with no monitored data
 * yield a null availability (rendered as a gap by the chart).
 * @param {Array<object>} beats Heartbeat-like records sorted by time ascending.
 * @param {{start:number, end:number}} range The Time_Range in unix seconds.
 * @param {number} bucketCount Number of buckets to split the range into (default 30).
 * @returns {Array<{time:number, availability:number|null}>} Per-bucket availability points.
 */
function calculateAvailabilityTimeSeries(beats, range, bucketCount = 30) {
    if (!range || range.end <= range.start) {
        return [];
    }

    const buckets = Math.max(1, Math.floor(bucketCount));
    const bucketDuration = (range.end - range.start) / buckets;
    const safeBeats = Array.isArray(beats) ? beats : [];

    const series = [];
    for (let i = 0; i < buckets; i++) {
        const bucketStart = range.start + i * bucketDuration;
        const bucketEnd = i === buckets - 1 ? range.end : bucketStart + bucketDuration;

        const bucketBeats = safeBeats.filter((b) => {
            const t = toUnixSeconds(b.time);
            return t >= bucketStart && t <= bucketEnd;
        });

        series.push({
            time: Math.floor(bucketStart),
            availability: calculateAvailability(bucketBeats, { start: bucketStart, end: bucketEnd }),
        });
    }

    return series;
}

/**
 * Calculate total uptime and downtime in seconds for a monitor within a time range.
 * MAINTENANCE beats are excluded entirely (not counted in either uptime or downtime).
 * PENDING beats are treated as UP.
 * Duration is computed from intervals between consecutive non-MAINTENANCE beats.
 * @param {Array<object>} beats Heartbeat-like records sorted by time ascending.
 * @param {{start:number, end:number}} range The Time_Range in unix seconds.
 * @returns {{uptimeSeconds:number|null, downtimeSeconds:number|null}} Durations, or null when no data.
 */
function calculateUptimeDowntime(beats, range) {
    if (!beats || beats.length === 0) {
        return { uptimeSeconds: null, downtimeSeconds: null };
    }

    // Filter out MAINTENANCE beats
    const filtered = beats.filter((b) => b.status !== MAINTENANCE);

    if (filtered.length < 2) {
        // Need at least two non-MAINTENANCE beats to form an interval
        return { uptimeSeconds: null, downtimeSeconds: null };
    }

    let uptimeSeconds = 0;
    let downtimeSeconds = 0;

    for (let i = 0; i < filtered.length - 1; i++) {
        const current = filtered[i];
        const next = filtered[i + 1];

        const currentTime = toUnixSeconds(current.time);
        const nextTime = toUnixSeconds(next.time);
        const duration = nextTime - currentTime;

        if (duration <= 0) {
            continue;
        }

        if (current.status === UP || current.status === PENDING) {
            uptimeSeconds += duration;
        } else if (current.status === DOWN) {
            downtimeSeconds += duration;
        }
    }

    return { uptimeSeconds, downtimeSeconds };
}

/**
 * Detect incidents: maximal continuous DOWN (status=0) intervals.
 * @param {Array<object>} beats Heartbeat records sorted by time ascending.
 * @returns {Array<{start:number, end:number|null, duration:number|null}>} Incidents.
 */
function detectIncidents(beats) {
    if (!beats || beats.length === 0) {
        return [];
    }

    const incidents = [];
    let incidentStart = null;

    for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];

        if (beat.status === DOWN) {
            // Start a new incident if not already in one
            if (incidentStart === null) {
                incidentStart = toUnixSeconds(beat.time);
            }
        } else {
            // Non-DOWN beat ends an ongoing incident
            if (incidentStart !== null) {
                const end = toUnixSeconds(beat.time);
                incidents.push({
                    start: incidentStart,
                    end: end,
                    duration: end - incidentStart,
                });
                incidentStart = null;
            }
        }
    }

    // If we reached the end while still in an incident, it's unresolved
    if (incidentStart !== null) {
        incidents.push({
            start: incidentStart,
            end: null,
            duration: null,
        });
    }

    return incidents;
}

/**
 * Convert a beat's time field to Unix seconds.
 * Handles both ISO/SQL datetime strings and numeric timestamps.
 * @param {string|number} time The time value from a heartbeat record.
 * @returns {number} Unix timestamp in seconds.
 */
function toUnixSeconds(time) {
    if (typeof time === "number") {
        // If already a unix timestamp in seconds (or milliseconds)
        // Heuristic: values > 1e12 are likely milliseconds
        return time > 1e12 ? Math.floor(time / 1000) : time;
    }
    // Parse string (e.g. "2024-01-15 00:00:00.000") using dayjs
    return dayjs.utc(time).unix();
}

/**
 * Mean Time To Recovery: average duration of resolved incidents.
 * @param {Array<{start:number, end:number|null, duration:number|null}>} incidents Incidents from detectIncidents.
 * @returns {number|null} Average duration in seconds, or null when none resolved.
 */
function calculateMTTR(incidents) {
    if (!incidents || incidents.length === 0) {
        return null;
    }

    // A resolved incident has both end and duration set (non-null)
    const resolved = incidents.filter((inc) => inc.end !== null && inc.duration !== null);

    if (resolved.length === 0) {
        return null;
    }

    const totalDuration = resolved.reduce((sum, inc) => sum + inc.duration, 0);
    return totalDuration / resolved.length;
}

/**
 * Min / max / average response time over UP/PENDING beats with a ping value.
 * @param {Array<object>} beats Heartbeat records.
 * @returns {{min:number|null, max:number|null, avg:number|null}} Stats.
 */
function calculateResponseTimeStats(beats) {
    if (!beats || beats.length === 0) {
        return { min: null, max: null, avg: null };
    }

    // Filter to UP/PENDING beats with a valid numeric ping
    const pings = [];
    for (const beat of beats) {
        if ((beat.status === UP || beat.status === PENDING) && beat.ping != null && Number.isFinite(beat.ping)) {
            pings.push(beat.ping);
        }
    }

    if (pings.length === 0) {
        return { min: null, max: null, avg: null };
    }

    let min = pings[0];
    let max = pings[0];
    let sum = 0;

    for (const p of pings) {
        if (p < min) {
            min = p;
        }
        if (p > max) {
            max = p;
        }
        sum += p;
    }

    // Round avg to 2 decimal places
    const avg = Math.round((sum / pings.length) * 100) / 100;

    return { min, max, avg };
}

/**
 * Build a response-time time series by bucketing beats across the time range.
 * Each bucket yields { time, min, avg, max } computed via calculateResponseTimeStats
 * over the beats whose timestamp falls inside the bucket. Buckets with no response
 * samples yield null min/avg/max (rendered as gaps by the chart).
 * @param {Array<object>} beats Heartbeat-like records sorted by time ascending.
 * @param {{start:number, end:number}} range The Time_Range in unix seconds.
 * @param {number} bucketCount Number of buckets to split the range into (default 30).
 * @returns {Array<{time:number, min:number|null, avg:number|null, max:number|null}>} Per-bucket stats.
 */
function calculateResponseTimeSeries(beats, range, bucketCount = 30) {
    if (!range || range.end <= range.start) {
        return [];
    }

    const buckets = Math.max(1, Math.floor(bucketCount));
    const bucketDuration = (range.end - range.start) / buckets;
    const safeBeats = Array.isArray(beats) ? beats : [];

    const series = [];
    for (let i = 0; i < buckets; i++) {
        const bucketStart = range.start + i * bucketDuration;
        const bucketEnd = i === buckets - 1 ? range.end : bucketStart + bucketDuration;

        const bucketBeats = safeBeats.filter((b) => {
            const t = toUnixSeconds(b.time);
            return t >= bucketStart && t <= bucketEnd;
        });

        const stats = calculateResponseTimeStats(bucketBeats);
        series.push({
            time: Math.floor(bucketStart),
            min: stats.min,
            avg: stats.avg,
            max: stats.max,
        });
    }

    return series;
}

/**
 * Format a numeric percentage to a fixed 2-decimal representation.
 * @param {number|null} value The raw percentage.
 * @returns {string|null} e.g. "99.95", or null when input is null.
 */
function formatPercentage(value) {
    if (value === null) {
        return null;
    }
    return value.toFixed(2);
}

/**
 * Sum up/down beat counts across pre-aggregated stat rows.
 * @param {Array<object>} statRows Aggregated stat rows ({up, down, ...}).
 * @returns {{up:number, down:number}} Total up and down counts.
 */
function sumStatCounts(statRows) {
    let up = 0;
    let down = 0;
    for (const r of statRows || []) {
        up += Number(r.up) || 0;
        down += Number(r.down) || 0;
    }
    return { up, down };
}

/**
 * Compute availability percentage from pre-aggregated stat rows.
 * up / (up + down); returns null when there is no monitored data.
 * @param {Array<object>} statRows Aggregated stat rows.
 * @returns {number|null} Percentage rounded to 2 decimals, or null when no data.
 */
function calculateAggregatedAvailability(statRows) {
    const { up, down } = sumStatCounts(statRows);
    const total = up + down;
    if (total === 0) {
        return null;
    }
    return Math.round((up / total) * 100 * 100) / 100;
}

/**
 * Estimate uptime/downtime seconds from aggregated counts over a time range.
 * Uptime/downtime are apportioned by the up/down ratio across the range duration.
 * This is an estimate suitable for long-range aggregated reporting.
 * @param {Array<object>} statRows Aggregated stat rows.
 * @param {{start:number, end:number}} range The Time_Range in unix seconds.
 * @returns {{uptimeSeconds:number|null, downtimeSeconds:number|null}} Estimated durations.
 */
function estimateAggregatedUptimeDowntime(statRows, range) {
    const { up, down } = sumStatCounts(statRows);
    const total = up + down;
    if (total === 0 || !range || range.end <= range.start) {
        return { uptimeSeconds: null, downtimeSeconds: null };
    }
    const duration = range.end - range.start;
    const uptimeSeconds = Math.round((up / total) * duration);
    return { uptimeSeconds, downtimeSeconds: duration - uptimeSeconds };
}

/**
 * Compute min/avg/max response time from pre-aggregated stat rows.
 * min/max come from ping_min/ping_max of buckets that had successful beats (up > 0);
 * avg is the up-weighted mean of each bucket's average ping.
 * @param {Array<object>} statRows Aggregated stat rows.
 * @returns {{min:number|null, max:number|null, avg:number|null}} Stats, nulls when no samples.
 */
function calculateAggregatedResponseTimeStats(statRows) {
    let min = null;
    let max = null;
    let weightedSum = 0;
    let weight = 0;

    for (const r of statRows || []) {
        const up = Number(r.up) || 0;
        if (up <= 0) {
            continue;
        }
        const pingMin = Number(r.ping_min);
        const pingMax = Number(r.ping_max);
        const pingAvg = Number(r.ping);

        if (Number.isFinite(pingMin) && (min === null || pingMin < min)) {
            min = pingMin;
        }
        if (Number.isFinite(pingMax) && (max === null || pingMax > max)) {
            max = pingMax;
        }
        if (Number.isFinite(pingAvg)) {
            weightedSum += pingAvg * up;
            weight += up;
        }
    }

    if (weight === 0) {
        return { min: null, max: null, avg: null };
    }
    const avg = Math.round((weightedSum / weight) * 100) / 100;
    return { min, max, avg };
}

/**
 * Build an availability time series from pre-aggregated stat rows (one point per bucket).
 * @param {Array<object>} statRows Aggregated stat rows ordered by timestamp ascending.
 * @returns {Array<{time:number, availability:number|null}>} Per-bucket availability points.
 */
function calculateAggregatedAvailabilityTimeSeries(statRows) {
    return (statRows || []).map((r) => {
        const up = Number(r.up) || 0;
        const down = Number(r.down) || 0;
        const total = up + down;
        return {
            time: Number(r.timestamp),
            availability: total === 0 ? null : Math.round((up / total) * 100 * 100) / 100,
        };
    });
}

/**
 * Build a response-time time series from pre-aggregated stat rows (one point per bucket).
 * @param {Array<object>} statRows Aggregated stat rows ordered by timestamp ascending.
 * @returns {Array<{time:number, min:number|null, avg:number|null, max:number|null}>} Per-bucket stats.
 */
function calculateAggregatedResponseTimeSeries(statRows) {
    return (statRows || []).map((r) => {
        const up = Number(r.up) || 0;
        if (up <= 0) {
            return { time: Number(r.timestamp), min: null, avg: null, max: null };
        }
        return {
            time: Number(r.timestamp),
            min: Number.isFinite(Number(r.ping_min)) ? Number(r.ping_min) : null,
            avg: Number.isFinite(Number(r.ping)) ? Number(r.ping) : null,
            max: Number.isFinite(Number(r.ping_max)) ? Number(r.ping_max) : null,
        };
    });
}

/**
 * Detect approximate incidents from pre-aggregated stat rows.
 * An incident is a maximal run of consecutive buckets (by timestamp) with down > 0.
 * Incident boundaries are approximate at the granularity of the bucket size.
 * @param {Array<object>} statRows Aggregated stat rows ordered by timestamp ascending.
 * @param {number} bucketSeconds The duration of a single bucket in seconds.
 * @returns {Array<{start:number, end:number, duration:number}>} Approximate incidents.
 */
function detectAggregatedIncidents(statRows, bucketSeconds) {
    const rows = statRows || [];
    const incidents = [];
    let runStart = null;
    let runLast = null;

    for (const r of rows) {
        const down = Number(r.down) || 0;
        const ts = Number(r.timestamp);
        if (down > 0) {
            if (runStart === null) {
                runStart = ts;
            }
            runLast = ts;
        } else if (runStart !== null) {
            const end = runLast + bucketSeconds;
            incidents.push({ start: runStart, end, duration: end - runStart });
            runStart = null;
            runLast = null;
        }
    }

    if (runStart !== null) {
        const end = runLast + bucketSeconds;
        incidents.push({ start: runStart, end, duration: end - runStart });
    }

    return incidents;
}

module.exports = {
    calculateAvailability,
    calculateAvailabilityTimeSeries,
    calculateUptimeDowntime,
    detectIncidents,
    calculateMTTR,
    calculateResponseTimeStats,
    calculateResponseTimeSeries,
    formatPercentage,
    sumStatCounts,
    calculateAggregatedAvailability,
    estimateAggregatedUptimeDowntime,
    calculateAggregatedResponseTimeStats,
    calculateAggregatedAvailabilityTimeSeries,
    calculateAggregatedResponseTimeSeries,
    detectAggregatedIncidents,
};
