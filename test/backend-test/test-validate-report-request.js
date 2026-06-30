const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// Intercept redbean-node R.findOne by patching it before the module loads
const redbeanNode = require("redbean-node");
const originalFindOne = redbeanNode.R.findOne;

const { validateReportRequest } = require("../../server/report/report-generator");

describe("validateReportRequest", () => {
    beforeEach(() => {
        // Reset to a default mock that returns a found monitor
        redbeanNode.R.findOne = async () => ({ id: 1 });
    });

    describe("periodType validation", () => {
        it("should reject invalid periodType", async () => {
            await assert.rejects(validateReportRequest({ periodType: "yearly", monitorIds: [1] }), (err) => {
                assert.strictEqual(err.message, "invalidPeriodType");
                assert.deepStrictEqual(err.details, { periodType: "yearly" });
                return true;
            });
        });

        it("should reject undefined periodType", async () => {
            await assert.rejects(validateReportRequest({ monitorIds: [1] }), (err) => {
                assert.strictEqual(err.message, "invalidPeriodType");
                return true;
            });
        });

        it("should reject null periodType", async () => {
            await assert.rejects(validateReportRequest({ periodType: null, monitorIds: [1] }), (err) => {
                assert.strictEqual(err.message, "invalidPeriodType");
                return true;
            });
        });
    });

    describe("custom period start/end validation", () => {
        it("should reject custom period without start", async () => {
            await assert.rejects(validateReportRequest({ periodType: "custom", end: 2000, monitorIds: [1] }), {
                message: "Custom period requires start and end",
            });
        });

        it("should reject custom period without end", async () => {
            await assert.rejects(validateReportRequest({ periodType: "custom", start: 1000, monitorIds: [1] }), {
                message: "Custom period requires start and end",
            });
        });
    });

    describe("start > end validation", () => {
        it("should reject when start > end", async () => {
            await assert.rejects(
                validateReportRequest({ periodType: "custom", start: 3000, end: 1000, monitorIds: [1] }),
                { message: "Start time must not be after end time" }
            );
        });
    });

    describe("monitorIds validation", () => {
        it("should reject when monitorIds is missing", async () => {
            await assert.rejects(validateReportRequest({ periodType: "daily", referenceDate: 1705318496 }), {
                message: "atLeastOneMonitorRequired",
            });
        });

        it("should reject when monitorIds is empty array", async () => {
            await assert.rejects(
                validateReportRequest({ periodType: "daily", referenceDate: 1705318496, monitorIds: [] }),
                { message: "atLeastOneMonitorRequired" }
            );
        });

        it("should reject when monitorIds is not an array", async () => {
            await assert.rejects(
                validateReportRequest({ periodType: "daily", referenceDate: 1705318496, monitorIds: 42 }),
                { message: "atLeastOneMonitorRequired" }
            );
        });
    });

    describe("monitor existence validation", () => {
        it("should reject when a monitor does not exist", async () => {
            redbeanNode.R.findOne = async () => null;

            await assert.rejects(
                validateReportRequest({ periodType: "daily", referenceDate: 1705318496, monitorIds: [999] }),
                (err) => {
                    assert.strictEqual(err.message, "monitorNotFound");
                    assert.deepStrictEqual(err.details, { missingIds: [999] });
                    return true;
                }
            );
        });

        it("should report all missing monitor IDs", async () => {
            redbeanNode.R.findOne = async (type, query, params) => {
                const id = params[0];
                if (id === 1) {
                    return { id: 1 };
                }
                return null;
            };

            await assert.rejects(
                validateReportRequest({ periodType: "daily", referenceDate: 1705318496, monitorIds: [1, 2, 3] }),
                (err) => {
                    assert.strictEqual(err.message, "monitorNotFound");
                    assert.deepStrictEqual(err.details, { missingIds: [2, 3] });
                    return true;
                }
            );
        });

        it("should pass when all monitors exist", async () => {
            redbeanNode.R.findOne = async () => ({ id: 1 });

            const result = await validateReportRequest({
                periodType: "daily",
                referenceDate: 1705318496,
                monitorIds: [1, 2],
            });

            assert.ok(result.start <= result.end);
        });
    });

    describe("validation order", () => {
        it("should check periodType before monitorIds", async () => {
            // Invalid periodType AND empty monitorIds - should get periodType error first
            await assert.rejects(validateReportRequest({ periodType: "invalid", monitorIds: [] }), {
                message: "invalidPeriodType",
            });
        });

        it("should check time range before monitorIds", async () => {
            // Valid periodType, invalid time range, empty monitorIds
            await assert.rejects(
                validateReportRequest({ periodType: "custom", start: 3000, end: 1000, monitorIds: [] }),
                { message: "Start time must not be after end time" }
            );
        });
    });
});
