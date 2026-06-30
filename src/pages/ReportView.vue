<template>
    <transition name="slide-fade" appear>
        <div>
            <div class="container-fluid">
                <h1 class="mb-3">{{ $t("SLA Report") }}</h1>

                <!-- Report Config Form -->
                <div class="shadow-box big-padding mb-4">
                    <ReportConfigForm @generate="onReportGenerated" />
                </div>

                <!-- Report Results (shown after generation) -->
                <div v-if="reportResult">
                    <!-- Export Button -->
                    <div class="mb-3 d-flex justify-content-end">
                        <button class="btn btn-primary" :disabled="exporting" @click="exportReport">
                            <span
                                v-if="exporting"
                                class="spinner-border spinner-border-sm me-1"
                                role="status"
                                aria-hidden="true"
                            ></span>
                            {{ $t("Export") }} ({{ exportFormat.toUpperCase() }})
                        </button>
                    </div>

                    <!-- Availability Chart -->
                    <div class="shadow-box big-padding mb-4">
                        <AvailabilityChart :data-points="availabilityDataPoints" />
                    </div>

                    <!-- Response Time Chart -->
                    <div class="shadow-box big-padding mb-4">
                        <ResponseTimeChart :data-points="responseTimeDataPoints" />
                    </div>

                    <!-- Incident Timeline -->
                    <div class="shadow-box big-padding mb-4">
                        <IncidentTimeline :incidents="incidents" />
                    </div>

                    <!-- Monitor Comparison Table (shown when multiple monitors) -->
                    <div v-if="hasMultipleMonitors" class="shadow-box big-padding mb-4">
                        <MonitorComparisonTable :report-result="reportResult" />
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<script>
import ReportConfigForm from "../components/report/ReportConfigForm.vue";
import AvailabilityChart from "../components/report/AvailabilityChart.vue";
import ResponseTimeChart from "../components/report/ResponseTimeChart.vue";
import IncidentTimeline from "../components/report/IncidentTimeline.vue";
import MonitorComparisonTable from "../components/report/MonitorComparisonTable.vue";

export default {
    components: {
        ReportConfigForm,
        AvailabilityChart,
        ResponseTimeChart,
        IncidentTimeline,
        MonitorComparisonTable,
    },

    data() {
        return {
            reportResult: null,
            reportRequest: null,
            exportFormat: "csv",
            exporting: false,
        };
    },

    computed: {
        /**
         * Whether the report contains multiple monitors for comparison view
         * @returns {boolean} true if more than one monitor in results
         */
        hasMultipleMonitors() {
            return this.reportResult && this.reportResult.monitors && this.reportResult.monitors.length > 1;
        },

        /**
         * Build availability data points for the chart.
         * Uses the first monitor time series data.
         * @returns {Array} Data points for the availability chart
         */
        availabilityDataPoints() {
            if (!this.reportResult || !this.reportResult.monitors) {
                return [];
            }
            const monitor = this.reportResult.monitors[0];
            if (!monitor || !monitor.availabilityTimeSeries) {
                return [];
            }
            return monitor.availabilityTimeSeries;
        },

        /**
         * Build response time data points for the chart.
         * Uses the first monitor time series data.
         * @returns {Array} Data points for the response time chart
         */
        responseTimeDataPoints() {
            if (!this.reportResult || !this.reportResult.monitors) {
                return [];
            }
            const monitor = this.reportResult.monitors[0];
            if (!monitor || !monitor.responseTimeSeries) {
                return [];
            }
            return monitor.responseTimeSeries;
        },

        /**
         * Get all incidents from the report result (across all monitors)
         * @returns {Array} Incidents sorted by start time descending
         */
        incidents() {
            if (!this.reportResult || !this.reportResult.monitors) {
                return [];
            }
            const allIncidents = [];
            for (const monitor of this.reportResult.monitors) {
                if (monitor.incidents && monitor.incidents.length > 0) {
                    allIncidents.push(...monitor.incidents);
                }
            }
            allIncidents.sort((a, b) => b.start - a.start);
            return allIncidents;
        },
    },

    methods: {
        /**
         * Handle report generation result from config form
         * @param {object} payload The generation payload
         * @returns {void}
         */
        onReportGenerated(payload) {
            this.reportResult = payload.reportResult;
            this.reportRequest = payload.reportRequest;
            this.exportFormat = payload.exportFormat;
        },

        /**
         * Export the current report via Socket.IO
         * @returns {void}
         */
        exportReport() {
            if (!this.reportRequest) {
                return;
            }
            this.exporting = true;
            this.$root.getSocket().emit(
                "exportReport",
                {
                    reportRequest: this.reportRequest,
                    format: this.exportFormat,
                },
                (res) => {
                    this.exporting = false;
                    if (res.ok) {
                        this.downloadFile(res.fileName, res.base64, this.exportFormat);
                    } else {
                        this.$root.toastError(res.msg);
                    }
                }
            );
        },

        /**
         * Trigger a file download from base64 data
         * @param {string} fileName The suggested file name
         * @param {string} base64Data The base64-encoded file content
         * @param {string} format The file format (csv or pdf)
         * @returns {void}
         */
        downloadFile(fileName, base64Data, format) {
            const mimeTypes = {
                csv: "text/csv;charset=utf-8",
                pdf: "application/pdf",
            };
            const mime = mimeTypes[format] || "application/octet-stream";
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mime });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        },
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    padding-top: 15px;
}
</style>
