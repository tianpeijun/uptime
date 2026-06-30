const { describe, test } = require("node:test");
const assert = require("node:assert");

const { calculateAvailability } = require("../../server/report/report-metrics");

describe("calculateAvailability", () => {
    const range = { start: 1000, end: 2000 };

    test("should return null for null beats", () => {
        assert.strictEqual(calculateAvailability(null, range), null);
    });

    test("should return null for empty beats array", () => {
        assert.strictEqual(calculateAvailability([], range), null);
    });

    test("should return null when all beats are MAINTENANCE", () => {
        const beats = [
            { status: 3, time: 1100 },
            { status: 3, time: 1200 },
            { status: 3, time: 1300 },
        ];
        assert.strictEqual(calculateAvailability(beats, range), null);
    });

    test("should return 100 when all beats are UP", () => {
        const beats = [
            { status: 1, time: 1100 },
            { status: 1, time: 1200 },
            { status: 1, time: 1300 },
        ];
        assert.strictEqual(calculateAvailability(beats, range), 100);
    });

    test("should return 0 when all beats are DOWN", () => {
        const beats = [
            { status: 0, time: 1100 },
            { status: 0, time: 1200 },
            { status: 0, time: 1300 },
        ];
        assert.strictEqual(calculateAvailability(beats, range), 0);
    });

    test("should exclude MAINTENANCE from calculation", () => {
        const beats = [
            { status: 1, time: 1100 },
            { status: 3, time: 1200 },
            { status: 0, time: 1300 },
        ];
        // 1 UP, 1 DOWN, 1 MAINTENANCE (excluded) => 1/(1+1) = 50%
        assert.strictEqual(calculateAvailability(beats, range), 50);
    });

    test("should count PENDING as UP", () => {
        const beats = [
            { status: 2, time: 1100 },
            { status: 1, time: 1200 },
            { status: 0, time: 1300 },
        ];
        // 2 UP (1 UP + 1 PENDING), 1 DOWN => 2/3 = 66.67%
        assert.strictEqual(calculateAvailability(beats, range), 66.67);
    });

    test("should round to 2 decimal places", () => {
        const beats = [
            { status: 1, time: 1100 },
            { status: 1, time: 1200 },
            { status: 0, time: 1300 },
        ];
        // 2/3 = 66.666... => 66.67
        assert.strictEqual(calculateAvailability(beats, range), 66.67);
    });

    test("should handle mixed statuses with MAINTENANCE excluded", () => {
        const beats = [
            { status: 1, time: 1100 },
            { status: 1, time: 1200 },
            { status: 1, time: 1300 },
            { status: 0, time: 1400 },
            { status: 3, time: 1500 },
            { status: 3, time: 1600 },
        ];
        // 3 UP, 1 DOWN, 2 MAINTENANCE (excluded) => 3/4 = 75%
        assert.strictEqual(calculateAvailability(beats, range), 75);
    });

    test("should return a number in range [0, 100]", () => {
        const beats = [
            { status: 1, time: 1100 },
            { status: 0, time: 1200 },
        ];
        const result = calculateAvailability(beats, range);
        assert.ok(result >= 0 && result <= 100, `Result ${result} not in [0, 100]`);
    });
});

const { calculateMTTR } = require("../../server/report/report-metrics");

describe("calculateMTTR", () => {
    test("should return null for null input", () => {
        assert.strictEqual(calculateMTTR(null), null);
    });

    test("should return null for empty array", () => {
        assert.strictEqual(calculateMTTR([]), null);
    });

    test("should return null when no incidents are resolved", () => {
        const incidents = [
            { start: 1000, end: null, duration: null },
            { start: 2000, end: null, duration: null },
        ];
        assert.strictEqual(calculateMTTR(incidents), null);
    });

    test("should return the duration when only one resolved incident", () => {
        const incidents = [{ start: 1000, end: 1300, duration: 300 }];
        assert.strictEqual(calculateMTTR(incidents), 300);
    });

    test("should return the average of multiple resolved incidents", () => {
        const incidents = [
            { start: 1000, end: 1200, duration: 200 },
            { start: 2000, end: 2600, duration: 600 },
        ];
        // (200 + 600) / 2 = 400
        assert.strictEqual(calculateMTTR(incidents), 400);
    });

    test("should ignore unresolved incidents in the average", () => {
        const incidents = [
            { start: 1000, end: 1200, duration: 200 },
            { start: 2000, end: null, duration: null },
            { start: 3000, end: 3900, duration: 900 },
        ];
        // Only resolved: (200 + 900) / 2 = 550
        assert.strictEqual(calculateMTTR(incidents), 550);
    });

    test("should not round the result", () => {
        const incidents = [
            { start: 1000, end: 1100, duration: 100 },
            { start: 2000, end: 2200, duration: 200 },
            { start: 3000, end: 3400, duration: 400 },
        ];
        // (100 + 200 + 400) / 3 = 233.333...
        const result = calculateMTTR(incidents);
        assert.ok(Math.abs(result - 700 / 3) < 1e-10, `Expected ~233.33, got ${result}`);
    });
});

const { formatPercentage } = require("../../server/report/report-metrics");

describe("formatPercentage", () => {
    test("should return null for null input", () => {
        assert.strictEqual(formatPercentage(null), null);
    });

    test("should format integer to 2 decimal places", () => {
        assert.strictEqual(formatPercentage(100), "100.00");
    });

    test("should format value with more than 2 decimals", () => {
        assert.strictEqual(formatPercentage(99.999), "100.00");
    });

    test("should format value with exactly 2 decimals", () => {
        assert.strictEqual(formatPercentage(99.95), "99.95");
    });

    test("should format zero correctly", () => {
        assert.strictEqual(formatPercentage(0), "0.00");
    });

    test("should format value with 1 decimal place", () => {
        assert.strictEqual(formatPercentage(50.5), "50.50");
    });

    test("output should match expected pattern", () => {
        const result = formatPercentage(66.67);
        assert.match(result, /^\d+\.\d{2}$/);
    });
});

const { calculateResponseTimeStats } = require("../../server/report/report-metrics");

describe("calculateResponseTimeStats", () => {
    test("should return all nulls for null beats", () => {
        const result = calculateResponseTimeStats(null);
        assert.deepStrictEqual(result, { min: null, max: null, avg: null });
    });

    test("should return all nulls for empty beats array", () => {
        const result = calculateResponseTimeStats([]);
        assert.deepStrictEqual(result, { min: null, max: null, avg: null });
    });

    test("should return all nulls when no beats have valid ping", () => {
        const beats = [
            { status: 1, ping: null },
            { status: 1, ping: undefined },
            { status: 1, ping: NaN },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.deepStrictEqual(result, { min: null, max: null, avg: null });
    });

    test("should return all nulls when all beats are DOWN", () => {
        const beats = [
            { status: 0, ping: 100 },
            { status: 0, ping: 200 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.deepStrictEqual(result, { min: null, max: null, avg: null });
    });

    test("should return all nulls when all beats are MAINTENANCE", () => {
        const beats = [
            { status: 3, ping: 50 },
            { status: 3, ping: 60 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.deepStrictEqual(result, { min: null, max: null, avg: null });
    });

    test("should compute stats from a single UP beat with ping", () => {
        const beats = [{ status: 1, ping: 42 }];
        const result = calculateResponseTimeStats(beats);
        assert.deepStrictEqual(result, { min: 42, max: 42, avg: 42 });
    });

    test("should compute min, max, avg from multiple UP beats", () => {
        const beats = [
            { status: 1, ping: 10 },
            { status: 1, ping: 20 },
            { status: 1, ping: 30 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.min, 10);
        assert.strictEqual(result.max, 30);
        assert.strictEqual(result.avg, 20);
    });

    test("should include PENDING beats in calculation", () => {
        const beats = [
            { status: 2, ping: 100 },
            { status: 1, ping: 200 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.min, 100);
        assert.strictEqual(result.max, 200);
        assert.strictEqual(result.avg, 150);
    });

    test("should exclude DOWN beats from stats", () => {
        const beats = [
            { status: 1, ping: 50 },
            { status: 0, ping: 999 },
            { status: 1, ping: 100 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.min, 50);
        assert.strictEqual(result.max, 100);
        assert.strictEqual(result.avg, 75);
    });

    test("should skip UP beats with null ping", () => {
        const beats = [
            { status: 1, ping: 10 },
            { status: 1, ping: null },
            { status: 1, ping: 30 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.min, 10);
        assert.strictEqual(result.max, 30);
        assert.strictEqual(result.avg, 20);
    });

    test("should round avg to 2 decimal places", () => {
        const beats = [
            { status: 1, ping: 10 },
            { status: 1, ping: 20 },
            { status: 1, ping: 33 },
        ];
        // avg = 63/3 = 21.0
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.avg, 21);

        // A case that produces a repeating decimal
        const beats2 = [
            { status: 1, ping: 10 },
            { status: 1, ping: 11 },
            { status: 1, ping: 12 },
        ];
        // avg = 33/3 = 11.0
        assert.strictEqual(calculateResponseTimeStats(beats2).avg, 11);

        // avg = (1 + 2) / 3 = 1.0
        const beats3 = [
            { status: 1, ping: 1 },
            { status: 1, ping: 1 },
            { status: 1, ping: 1 },
        ];
        assert.strictEqual(calculateResponseTimeStats(beats3).avg, 1);
    });

    test("should round avg correctly for non-terminating decimals", () => {
        const beats = [
            { status: 1, ping: 10 },
            { status: 1, ping: 20 },
            { status: 1, ping: 31 },
        ];
        // avg = 61/3 = 20.333...
        const result = calculateResponseTimeStats(beats);
        assert.strictEqual(result.avg, 20.33);
    });

    test("should satisfy min <= avg <= max", () => {
        const beats = [
            { status: 1, ping: 5 },
            { status: 1, ping: 150 },
            { status: 2, ping: 75 },
            { status: 1, ping: 200 },
        ];
        const result = calculateResponseTimeStats(beats);
        assert.ok(result.min <= result.avg, `min(${result.min}) should be <= avg(${result.avg})`);
        assert.ok(result.avg <= result.max, `avg(${result.avg}) should be <= max(${result.max})`);
    });

    test("min and max should belong to the sample set", () => {
        const beats = [
            { status: 1, ping: 15 },
            { status: 1, ping: 42 },
            { status: 2, ping: 7 },
            { status: 1, ping: 99 },
        ];
        const pings = [15, 42, 7, 99];
        const result = calculateResponseTimeStats(beats);
        assert.ok(pings.includes(result.min), `min(${result.min}) should be in sample set`);
        assert.ok(pings.includes(result.max), `max(${result.max}) should be in sample set`);
    });
});
