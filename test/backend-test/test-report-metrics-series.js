const { describe, test } = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");

const {
    calculateAvailabilityTimeSeries,
    calculateResponseTimeSeries,
} = require("../../server/report/report-metrics");

const UP = 1;
const DOWN = 0;

/**
 * fast-check arbitrary producing a heartbeat-like record within a range.
 * @param {number} start Range start (unix seconds).
 * @param {number} end Range end (unix seconds).
 * @returns {object} A fast-check arbitrary for a heartbeat.
 */
function beatArb(start, end) {
    return fc.record({
        time: fc.integer({ min: start, max: end }),
        status: fc.constantFrom(UP, DOWN),
        ping: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
    });
}

describe("calculateAvailabilityTimeSeries", () => {
    test("returns the requested number of ascending, in-range buckets", () => {
        const range = { start: 1705276800, end: 1705363200 };
        const series = calculateAvailabilityTimeSeries([], range, 10);
        assert.strictEqual(series.length, 10);
        for (let i = 0; i < series.length; i++) {
            assert.ok(series[i].time >= range.start && series[i].time <= range.end);
            if (i > 0) {
                assert.ok(series[i].time >= series[i - 1].time, "bucket times should be ascending");
            }
            // Empty input → no monitored data → availability null per design.
            assert.strictEqual(series[i].availability, null);
        }
    });

    test("returns empty array for a degenerate range", () => {
        assert.deepStrictEqual(calculateAvailabilityTimeSeries([], { start: 100, end: 100 }), []);
    });

    test("each bucket availability is null or within [0,100]", () => {
        const range = { start: 1705276800, end: 1705363200 };
        fc.assert(
            fc.property(fc.array(beatArb(range.start, range.end), { maxLength: 200 }), (beats) => {
                beats.sort((a, b) => a.time - b.time);
                const series = calculateAvailabilityTimeSeries(beats, range);
                for (const point of series) {
                    assert.ok(Object.prototype.hasOwnProperty.call(point, "time"));
                    assert.ok(Object.prototype.hasOwnProperty.call(point, "availability"));
                    if (point.availability !== null) {
                        assert.ok(point.availability >= 0 && point.availability <= 100);
                    }
                }
            }),
            { numRuns: 100 }
        );
    });
});

describe("calculateResponseTimeSeries", () => {
    test("returns {time,min,avg,max} buckets with min<=avg<=max when present", () => {
        const range = { start: 1705276800, end: 1705363200 };
        fc.assert(
            fc.property(fc.array(beatArb(range.start, range.end), { maxLength: 200 }), (beats) => {
                beats.sort((a, b) => a.time - b.time);
                const series = calculateResponseTimeSeries(beats, range);
                for (const point of series) {
                    assert.ok(Object.prototype.hasOwnProperty.call(point, "time"));
                    for (const key of ["min", "avg", "max"]) {
                        assert.ok(Object.prototype.hasOwnProperty.call(point, key), `missing ${key}`);
                    }
                    if (point.min !== null && point.avg !== null && point.max !== null) {
                        assert.ok(point.min <= point.avg, "min <= avg");
                        assert.ok(point.avg <= point.max, "avg <= max");
                    }
                }
            }),
            { numRuns: 100 }
        );
    });

    test("buckets with no response samples yield null min/avg/max", () => {
        const range = { start: 1705276800, end: 1705363200 };
        const series = calculateResponseTimeSeries([], range, 5);
        assert.strictEqual(series.length, 5);
        for (const point of series) {
            assert.strictEqual(point.min, null);
            assert.strictEqual(point.avg, null);
            assert.strictEqual(point.max, null);
        }
    });
});
