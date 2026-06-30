const { describe, it } = require("node:test");
const assert = require("node:assert");
const { resolveTimeRange } = require("../../server/report/report-generator");

describe("resolveTimeRange", () => {
    describe("daily", () => {
        it("should resolve to the full UTC day containing referenceDate", () => {
            // 2024-01-15T12:34:56Z
            const result = resolveTimeRange({ periodType: "daily", referenceDate: 1705318496 });
            // 2024-01-15T00:00:00Z
            assert.strictEqual(result.start, 1705276800);
            // 2024-01-15T23:59:59Z
            assert.strictEqual(result.end, 1705363199);
        });

        it("should handle midnight edge case (start of day)", () => {
            // 2024-01-15T00:00:00Z exactly
            const result = resolveTimeRange({ periodType: "daily", referenceDate: 1705276800 });
            assert.strictEqual(result.start, 1705276800);
            assert.strictEqual(result.end, 1705363199);
        });
    });

    describe("weekly", () => {
        it("should resolve to Monday-Sunday ISO week containing referenceDate", () => {
            // 2024-01-17T15:20:00Z (Wednesday)
            const result = resolveTimeRange({ periodType: "weekly", referenceDate: 1705500000 });
            // Monday 2024-01-15T00:00:00Z
            assert.strictEqual(result.start, 1705276800);
            // Sunday 2024-01-21T23:59:59Z
            assert.strictEqual(result.end, 1705881599);
        });

        it("should handle Monday referenceDate (start of week)", () => {
            // 2024-01-15T10:00:00Z (Monday)
            const result = resolveTimeRange({ periodType: "weekly", referenceDate: 1705312800 });
            assert.strictEqual(result.start, 1705276800);
            assert.strictEqual(result.end, 1705881599);
        });

        it("should handle Sunday referenceDate (end of week)", () => {
            // 2024-01-21T20:00:00Z (Sunday)
            const result = resolveTimeRange({ periodType: "weekly", referenceDate: 1705867200 });
            assert.strictEqual(result.start, 1705276800);
            assert.strictEqual(result.end, 1705881599);
        });
    });

    describe("monthly", () => {
        it("should resolve to the full month containing referenceDate", () => {
            // 2024-02-15T~06:06:40Z
            const result = resolveTimeRange({ periodType: "monthly", referenceDate: 1708000000 });
            // 2024-02-01T00:00:00Z
            assert.strictEqual(result.start, 1706745600);
            // 2024-02-29T23:59:59Z (leap year)
            assert.strictEqual(result.end, 1709251199);
        });

        it("should handle January correctly (31 days)", () => {
            // 2024-01-15T12:34:56Z
            const result = resolveTimeRange({ periodType: "monthly", referenceDate: 1705318496 });
            // 2024-01-01T00:00:00Z
            assert.strictEqual(result.start, 1704067200);
            // 2024-01-31T23:59:59Z
            assert.strictEqual(result.end, 1706745599);
        });
    });

    describe("custom", () => {
        it("should use explicit start and end", () => {
            const result = resolveTimeRange({ periodType: "custom", start: 1000, end: 2000 });
            assert.strictEqual(result.start, 1000);
            assert.strictEqual(result.end, 2000);
        });

        it("should throw when start is missing", () => {
            assert.throws(() => resolveTimeRange({ periodType: "custom", end: 2000 }), {
                message: "Custom period requires start and end",
            });
        });

        it("should throw when end is missing", () => {
            assert.throws(() => resolveTimeRange({ periodType: "custom", start: 1000 }), {
                message: "Custom period requires start and end",
            });
        });

        it("should throw when both start and end are missing", () => {
            assert.throws(() => resolveTimeRange({ periodType: "custom" }), {
                message: "Custom period requires start and end",
            });
        });
    });

    describe("validation", () => {
        it("should throw when start > end (custom)", () => {
            assert.throws(() => resolveTimeRange({ periodType: "custom", start: 3000, end: 1000 }), {
                message: "Start time must not be after end time",
            });
        });

        it("should throw for invalid periodType", () => {
            assert.throws(() => resolveTimeRange({ periodType: "yearly" }), /Invalid periodType/);
        });
    });

    describe("invariants", () => {
        it("should always return start <= end for daily", () => {
            const result = resolveTimeRange({ periodType: "daily", referenceDate: 1705318496 });
            assert.ok(result.start <= result.end);
        });

        it("should always return start <= end for weekly", () => {
            const result = resolveTimeRange({ periodType: "weekly", referenceDate: 1705318496 });
            assert.ok(result.start <= result.end);
        });

        it("should always return start <= end for monthly", () => {
            const result = resolveTimeRange({ periodType: "monthly", referenceDate: 1705318496 });
            assert.ok(result.start <= result.end);
        });

        it("weekly span should be exactly 7 days minus 1 second", () => {
            const result = resolveTimeRange({ periodType: "weekly", referenceDate: 1705318496 });
            const span = result.end - result.start;
            // 7 days = 7*24*60*60 = 604800 seconds, minus 1 for endOf
            assert.strictEqual(span, 604799);
        });
    });
});
