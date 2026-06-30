const { describe, test } = require("node:test");
const assert = require("node:assert");

const {
    calculateAggregatedAvailability,
    estimateAggregatedUptimeDowntime,
    calculateAggregatedResponseTimeStats,
    calculateAggregatedAvailabilityTimeSeries,
    calculateAggregatedResponseTimeSeries,
    detectAggregatedIncidents,
} = require("../../server/report/report-metrics");

/**
 * Build a stat row with the columns the report metrics read.
 * @param {number} timestamp Unix timestamp of the bucket.
 * @param {number} up Up beat count.
 * @param {number} down Down beat count.
 * @param {object} ping Ping fields {avg, min, max}.
 * @returns {object} A stat-row-like object.
 */
function statRow(timestamp, up, down, ping = {}) {
    return {
        timestamp,
        up,
        down,
        ping: ping.avg ?? 0,
        ping_min: ping.min ?? 0,
        ping_max: ping.max ?? 0,
    };
}

describe("calculateAggregatedAvailability", () => {
    test("computes up/(up+down) as a 2-decimal percentage", () => {
        const rows = [statRow(100, 9, 1), statRow(160, 10, 0)];
        // up=19, down=1 → 95.00
        assert.strictEqual(calculateAggregatedAvailability(rows), 95);
    });

    test("returns null when there is no monitored data", () => {
        assert.strictEqual(calculateAggregatedAvailability([]), null);
        assert.strictEqual(calculateAggregatedAvailability([statRow(100, 0, 0)]), null);
    });
});

describe("estimateAggregatedUptimeDowntime", () => {
    test("apportions range duration by the up/down ratio and conserves total", () => {
        const range = { start: 0, end: 1000 };
        const rows = [statRow(0, 3, 1)]; // 75% up
        const { uptimeSeconds, downtimeSeconds } = estimateAggregatedUptimeDowntime(rows, range);
        assert.strictEqual(uptimeSeconds, 750);
        assert.strictEqual(downtimeSeconds, 250);
        assert.strictEqual(uptimeSeconds + downtimeSeconds, range.end - range.start);
    });

    test("returns nulls when no data or degenerate range", () => {
        assert.deepStrictEqual(estimateAggregatedUptimeDowntime([], { start: 0, end: 100 }), {
            uptimeSeconds: null,
            downtimeSeconds: null,
        });
    });
});

describe("calculateAggregatedResponseTimeStats", () => {
    test("derives min/max from up>0 buckets and up-weighted average", () => {
        const rows = [
            statRow(0, 2, 0, { avg: 10, min: 5, max: 20 }),
            statRow(60, 8, 0, { avg: 20, min: 8, max: 40 }),
            statRow(120, 0, 3, { avg: 0, min: 0, max: 0 }), // down bucket ignored for response time
        ];
        const stats = calculateAggregatedResponseTimeStats(rows);
        assert.strictEqual(stats.min, 5);
        assert.strictEqual(stats.max, 40);
        // weighted avg = (10*2 + 20*8) / 10 = 18
        assert.strictEqual(stats.avg, 18);
    });

    test("returns nulls when no up buckets exist", () => {
        assert.deepStrictEqual(calculateAggregatedResponseTimeStats([statRow(0, 0, 5)]), {
            min: null,
            max: null,
            avg: null,
        });
    });
});

describe("calculateAggregatedAvailabilityTimeSeries", () => {
    test("maps each bucket to {time, availability}", () => {
        const rows = [statRow(100, 1, 1), statRow(160, 0, 0)];
        const series = calculateAggregatedAvailabilityTimeSeries(rows);
        assert.deepStrictEqual(series, [
            { time: 100, availability: 50 },
            { time: 160, availability: null },
        ]);
    });
});

describe("calculateAggregatedResponseTimeSeries", () => {
    test("maps up buckets to ping stats and down-only buckets to nulls", () => {
        const rows = [statRow(100, 5, 0, { avg: 30, min: 10, max: 60 }), statRow(160, 0, 2)];
        const series = calculateAggregatedResponseTimeSeries(rows);
        assert.deepStrictEqual(series[0], { time: 100, min: 10, avg: 30, max: 60 });
        assert.deepStrictEqual(series[1], { time: 160, min: null, avg: null, max: null });
    });
});

describe("detectAggregatedIncidents", () => {
    test("groups consecutive down buckets into approximate incidents", () => {
        const bucket = 60;
        const rows = [
            statRow(0, 5, 0),
            statRow(60, 0, 2), // incident A start
            statRow(120, 0, 1), // incident A continues
            statRow(180, 5, 0), // recovery
            statRow(240, 0, 3), // incident B
            statRow(300, 5, 0),
        ];
        const incidents = detectAggregatedIncidents(rows, bucket);
        assert.strictEqual(incidents.length, 2);
        // Incident A: starts at 60, last down bucket at 120, end = 120 + 60 = 180
        assert.deepStrictEqual(incidents[0], { start: 60, end: 180, duration: 120 });
        // Incident B: single bucket at 240, end = 240 + 60 = 300
        assert.deepStrictEqual(incidents[1], { start: 240, end: 300, duration: 60 });
    });

    test("returns an unresolved-style trailing incident when data ends while down", () => {
        const incidents = detectAggregatedIncidents([statRow(0, 0, 1), statRow(60, 0, 1)], 60);
        assert.strictEqual(incidents.length, 1);
        assert.strictEqual(incidents[0].start, 0);
        assert.strictEqual(incidents[0].end, 120);
    });

    test("returns no incidents when there are no down buckets", () => {
        assert.deepStrictEqual(detectAggregatedIncidents([statRow(0, 5, 0)], 60), []);
    });
});
