/**
 * Report exporter module.
 * Renders Report_Result into PDF or CSV artifacts for download or email attachment.
 * @module server/report/report-exporter
 */

/**
 * Render a Report_Result to a PDF buffer using pdfkit.
 * Includes time range, generation instant, availability metrics, charts, incidents.
 * @param {object} reportResult The Report_Result.
 * @returns {Promise<{fileName:string, buffer:Buffer}>} The PDF artifact.
 */
async function exportPdf(reportResult) {
    const PDFDocument = require("pdfkit");

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const timestamp = new Date(reportResult.generatedAt * 1000).toISOString().replace(/[:.]/g, "-");
            resolve({ fileName: `sla-report-${timestamp}.pdf`, buffer });
        });
        doc.on("error", reject);

        // Title
        doc.fontSize(18).text("SLA Availability Report", { align: "center" });
        doc.moveDown();

        // Metadata: Time Range and Generated At
        const rangeStart = formatTimestamp(reportResult.timeRange.start);
        const rangeEnd = formatTimestamp(reportResult.timeRange.end);
        const generatedAt = formatTimestamp(reportResult.generatedAt);

        doc.fontSize(10).text(`Time Range: ${rangeStart} → ${rangeEnd}`);
        doc.text(`Generated At: ${generatedAt}`);
        doc.moveDown();

        // Per-monitor sections
        const monitors = reportResult.monitors || [];
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];

            if (i > 0) {
                doc.addPage();
            }

            // Monitor header
            doc.fontSize(14).text(`Monitor ID: ${monitor.monitorId}`, {
                underline: true,
            });
            doc.moveDown(0.5);

            // Metrics table
            doc.fontSize(10);
            doc.text(`Availability: ${displayValue(monitor.availabilityPercentage, "%")}`);
            doc.text(`Uptime: ${displaySeconds(monitor.uptimeSeconds)}`);
            doc.text(`Downtime: ${displaySeconds(monitor.downtimeSeconds)}`);
            doc.text(`Incident Count: ${displayValue(monitor.incidentCount)}`);
            doc.text(`MTTR: ${displaySeconds(monitor.mttrSeconds)}`);

            const rt = monitor.responseTime || {};
            doc.text(
                `Response Time (min / max / avg): ${displayValue(rt.min, " ms")} / ${displayValue(rt.max, " ms")} / ${displayValue(rt.avg, " ms")}`
            );
            doc.moveDown();

            // Incidents list
            const incidents = monitor.incidents || [];
            if (incidents.length > 0) {
                doc.fontSize(12).text("Incidents", { underline: true });
                doc.moveDown(0.3);
                doc.fontSize(9);

                for (const incident of incidents) {
                    const incStart = formatTimestamp(incident.start);
                    const incEnd = incident.end != null ? formatTimestamp(incident.end) : "Ongoing";
                    const incDuration = incident.duration != null ? `${incident.duration}s` : "N/A";
                    doc.text(`  • Start: ${incStart}  |  End: ${incEnd}  |  Duration: ${incDuration}`);
                }
            } else {
                doc.fontSize(10).text("No incidents in this time range.");
            }
        }

        doc.end();
    });
}

/**
 * Display a value with an optional suffix, returning "N/A" for null/undefined.
 * @param {number|string|null|undefined} value The value to display.
 * @param {string} suffix Suffix to append when value is present.
 * @returns {string} Formatted display string.
 */
function displayValue(value, suffix = "") {
    if (value == null) {
        return "N/A";
    }
    return `${value}${suffix}`;
}

/**
 * Display seconds value with "s" suffix, or "N/A" for null/undefined.
 * @param {number|null|undefined} seconds Duration in seconds.
 * @returns {string} Formatted duration string.
 */
function displaySeconds(seconds) {
    if (seconds == null) {
        return "N/A";
    }
    return `${seconds}s`;
}

/**
 * Escape a CSV field value. If the field contains commas, quotes, or newlines,
 * wrap it in double quotes and escape internal quotes by doubling them.
 * @param {string} value The raw field value.
 * @returns {string} The escaped field value safe for CSV inclusion.
 */
function escapeCsvField(value) {
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Format a Unix-second timestamp to an ISO 8601 date string.
 * Returns "N/A" when the value is null or undefined.
 * @param {number|null|undefined} unixSeconds The timestamp in seconds.
 * @returns {string} ISO date string or "N/A".
 */
function formatTimestamp(unixSeconds) {
    if (unixSeconds == null) {
        return "N/A";
    }
    return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Render a Report_Result to a UTF-8 CSV buffer.
 * Includes per-monitor availability metrics and incident records.
 * CSV is encoded as UTF-8 with BOM for spreadsheet compatibility.
 * @param {object} reportResult The Report_Result.
 * @returns {Promise<{fileName:string, buffer:Buffer}>} The CSV artifact (UTF-8).
 */
async function exportCsv(reportResult) {
    const BOM = "\uFEFF";
    const lines = [];

    // Metadata header rows
    lines.push(
        escapeCsvField("Time Range Start") + "," + escapeCsvField(formatTimestamp(reportResult.timeRange.start))
    );
    lines.push(escapeCsvField("Time Range End") + "," + escapeCsvField(formatTimestamp(reportResult.timeRange.end)));
    lines.push(escapeCsvField("Generated At") + "," + escapeCsvField(formatTimestamp(reportResult.generatedAt)));
    lines.push(""); // Empty line separator

    // Per-monitor sections
    for (let i = 0; i < reportResult.monitors.length; i++) {
        const monitor = reportResult.monitors[i];

        // Monitor section header
        lines.push(escapeCsvField("Monitor ID") + "," + escapeCsvField(String(monitor.monitorId)));

        // Metrics rows
        lines.push(escapeCsvField("Metric") + "," + escapeCsvField("Value"));
        lines.push(
            escapeCsvField("Availability") +
                "," +
                escapeCsvField(monitor.availabilityPercentage != null ? monitor.availabilityPercentage : "N/A")
        );
        lines.push(
            escapeCsvField("Uptime (s)") +
                "," +
                escapeCsvField(monitor.uptimeSeconds != null ? String(monitor.uptimeSeconds) : "N/A")
        );
        lines.push(
            escapeCsvField("Downtime (s)") +
                "," +
                escapeCsvField(monitor.downtimeSeconds != null ? String(monitor.downtimeSeconds) : "N/A")
        );
        lines.push(
            escapeCsvField("Incident Count") +
                "," +
                escapeCsvField(monitor.incidentCount != null ? String(monitor.incidentCount) : "N/A")
        );
        lines.push(
            escapeCsvField("MTTR (s)") +
                "," +
                escapeCsvField(monitor.mttrSeconds != null ? String(monitor.mttrSeconds) : "N/A")
        );
        lines.push(
            escapeCsvField("Min Response (ms)") +
                "," +
                escapeCsvField(
                    monitor.responseTime && monitor.responseTime.min != null ? String(monitor.responseTime.min) : "N/A"
                )
        );
        lines.push(
            escapeCsvField("Max Response (ms)") +
                "," +
                escapeCsvField(
                    monitor.responseTime && monitor.responseTime.max != null ? String(monitor.responseTime.max) : "N/A"
                )
        );
        lines.push(
            escapeCsvField("Avg Response (ms)") +
                "," +
                escapeCsvField(
                    monitor.responseTime && monitor.responseTime.avg != null ? String(monitor.responseTime.avg) : "N/A"
                )
        );
        lines.push(""); // Empty line

        // Incidents section
        lines.push(
            escapeCsvField("Incident Start") +
                "," +
                escapeCsvField("Incident End") +
                "," +
                escapeCsvField("Duration (s)")
        );
        const incidents = monitor.incidents || [];
        for (const incident of incidents) {
            const startStr = formatTimestamp(incident.start);
            const endStr = incident.end != null ? formatTimestamp(incident.end) : "Unresolved";
            const durationStr = incident.duration != null ? String(incident.duration) : "N/A";
            lines.push(escapeCsvField(startStr) + "," + escapeCsvField(endStr) + "," + escapeCsvField(durationStr));
        }

        // Empty line separator between monitors (not after the last one)
        if (i < reportResult.monitors.length - 1) {
            lines.push("");
        }
    }

    const csvContent = BOM + lines.join("\n");
    const buffer = Buffer.from(csvContent, "utf-8");
    const timestamp = new Date(reportResult.generatedAt * 1000).toISOString().replace(/[:.]/g, "-");
    const fileName = `sla-report-${timestamp}.csv`;

    return { fileName, buffer };
}

module.exports = {
    exportPdf,
    exportCsv,
};
