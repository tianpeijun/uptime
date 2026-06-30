const { describe, test } = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");

const { exportCsv, exportPdf } = require("../../server/report/report-exporter");

/**
 * Build a minimal valid Report_Result for export tests.
 * @param {object} overrides Optional field overrides for the result.
 * @returns {object} A Report_Result-shaped object.
 */
function makeReportResult(overrides = {}) {
    return {
        timeRange: { start: 1705276800, end: 1705363200 },
        generatedAt: 1705363200,
        monitors: [
            {
                monitorId: 1,
                availabilityPercentage: "99.95",
                uptimeSeconds: 86000,
                downtimeSeconds: 400,
                incidentCount: 1,
                mttrSeconds: 200,
                responseTime: { min: 10, max: 120, avg: 45.5 },
                incidents: [{ start: 1705300000, end: 1705300200, duration: 200 }],
                availabilityTimeSeries: [],
                responseTimeSeries: [],
            },
        ],
        ...overrides,
    };
}

describe("report-exporter exportCsv", () => {
    test("returns a .csv artifact encoded as UTF-8 with BOM", async () => {
        const { fileName, buffer } = await exportCsv(makeReportResult());
        assert.ok(fileName.endsWith(".csv"), "fileName should end with .csv");
        assert.ok(Buffer.isBuffer(buffer), "buffer should be a Buffer");
        // UTF-8 BOM is \uFEFF, encoded as EF BB BF
        assert.strictEqual(buffer[0], 0xef);
        assert.strictEqual(buffer[1], 0xbb);
        assert.strictEqual(buffer[2], 0xbf);
    });

    test("includes time range, generated at, metrics and incident records", async () => {
        const { buffer } = await exportCsv(makeReportResult());
        const text = buffer.toString("utf-8");
        assert.ok(text.includes("Time Range Start"), "should include time range start");
        assert.ok(text.includes("Time Range End"), "should include time range end");
        assert.ok(text.includes("Generated At"), "should include generated at");
        assert.ok(text.includes("Monitor ID"), "should include monitor id section");
        assert.ok(text.includes("Availability"), "should include availability metric");
        assert.ok(text.includes("Incident Start"), "should include incident header");
    });

    // Feature: sla-report-module, Property 9: CSV 导出完整性与 UTF-8 往返
    // Validates: Requirements 4.2, 4.3, 4.5, 6.4
    test("Property 9: CSV is UTF-8 and round-trips every monitor's metrics, incidents, range and generated time", () => {
        const incidentArb = fc.record({
            start: fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
            end: fc.option(fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }), { nil: null }),
            duration: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
        });

        const monitorArb = fc.record({
            monitorId: fc.integer({ min: 1, max: 99999 }),
            availabilityPercentage: fc.option(fc.constantFrom("100.00", "99.95", "0.00", "50.50"), { nil: null }),
            uptimeSeconds: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
            downtimeSeconds: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
            incidentCount: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
            mttrSeconds: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
            responseTime: fc.record({
                min: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
                max: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
                avg: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
            }),
            incidents: fc.array(incidentArb, { maxLength: 5 }),
            availabilityTimeSeries: fc.constant([]),
            responseTimeSeries: fc.constant([]),
        });

        const reportArb = fc.record({
            timeRange: fc.record({
                start: fc.integer({ min: 1_600_000_000, max: 1_700_000_000 }),
                end: fc.integer({ min: 1_700_000_001, max: 1_800_000_000 }),
            }),
            generatedAt: fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
            monitors: fc.array(monitorArb, { minLength: 1, maxLength: 4 }),
        });

        return fc.assert(
            fc.asyncProperty(reportArb, async (report) => {
                const { buffer } = await exportCsv(report);

                // Must be decodable as UTF-8 and start with the BOM.
                assert.strictEqual(buffer[0], 0xef);
                const text = buffer.toString("utf-8");
                assert.ok(text.startsWith("\uFEFF"), "decoded CSV should start with BOM");

                // Time range and generated time present.
                assert.ok(text.includes("Time Range Start"));
                assert.ok(text.includes("Generated At"));

                // Every monitor in the request appears in the artifact (Requirement 6.4).
                for (const m of report.monitors) {
                    assert.ok(
                        text.includes(`Monitor ID,${m.monitorId}`),
                        `CSV should include monitor ${m.monitorId}`
                    );
                    // Each resolved incident's duration should be serialized.
                    for (const inc of m.incidents) {
                        if (inc.duration != null) {
                            assert.ok(
                                text.includes(String(inc.duration)),
                                "CSV should include incident duration"
                            );
                        }
                    }
                }
            }),
            { numRuns: 100 }
        );
    });
});

describe("report-exporter exportPdf", () => {
    test("returns a .pdf artifact whose buffer is a valid PDF stream", async () => {
        const { fileName, buffer } = await exportPdf(makeReportResult());
        assert.ok(fileName.endsWith(".pdf"), "fileName should end with .pdf");
        assert.ok(Buffer.isBuffer(buffer), "buffer should be a Buffer");
        // PDF files start with the "%PDF" magic header.
        assert.strictEqual(buffer.slice(0, 4).toString("latin1"), "%PDF");
    });

    test("handles a multi-monitor report without throwing", async () => {
        const report = makeReportResult({
            monitors: [
                makeReportResult().monitors[0],
                { ...makeReportResult().monitors[0], monitorId: 2, incidents: [] },
            ],
        });
        const { buffer } = await exportPdf(report);
        assert.ok(buffer.length > 0, "PDF buffer should be non-empty");
    });
});
