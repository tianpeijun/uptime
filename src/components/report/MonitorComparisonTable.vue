<template>
    <div class="monitor-comparison-table">
        <div class="comparison-header">
            <h4>{{ $t("Monitor Comparison") }}</h4>
            <span class="time-range-label badge bg-secondary">{{ formattedTimeRange }}</span>
        </div>
        <div v-if="!hasMonitors" class="empty-state text-center text-muted py-4">
            {{ $t("No monitor data available") }}
        </div>
        <div v-else class="table-responsive">
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th class="metric-header">{{ $t("Metric") }}</th>
                        <th
                            v-for="monitor in reportResult.monitors"
                            :key="monitor.monitorId"
                            class="monitor-column text-center"
                        >
                            {{ monitorName(monitor.monitorId) }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="metric-label">{{ $t("Availability") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'avail-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span
                                v-if="monitor.availabilityPercentage !== null"
                                class="availability-value"
                                :class="availabilityClass(monitor.availabilityPercentage)"
                            >
                                {{ monitor.availabilityPercentage }}%
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Total Uptime") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'up-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.uptimeSeconds !== null">
                                {{ formatDuration(monitor.uptimeSeconds) }}
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Total Downtime") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'down-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.downtimeSeconds !== null">
                                {{ formatDuration(monitor.downtimeSeconds) }}
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Incidents") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'inc-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.incidentCount !== null">{{ monitor.incidentCount }}</span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("MTTR") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'mttr-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.mttrSeconds !== null">{{ formatDuration(monitor.mttrSeconds) }}</span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Resp. Time (Min)") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'rtmin-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.responseTime && monitor.responseTime.min !== null">
                                {{ monitor.responseTime.min }} ms
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Resp. Time (Avg)") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'rtavg-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.responseTime && monitor.responseTime.avg !== null">
                                {{ monitor.responseTime.avg }} ms
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                    <tr>
                        <td class="metric-label">{{ $t("Resp. Time (Max)") }}</td>
                        <td
                            v-for="monitor in reportResult.monitors"
                            :key="'rtmax-' + monitor.monitorId"
                            class="text-center"
                        >
                            <span v-if="monitor.responseTime && monitor.responseTime.max !== null">
                                {{ monitor.responseTime.max }} ms
                            </span>
                            <span v-else class="text-muted">{{ $t("N/A") }}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
<script>
import dayjs from "dayjs";

export default {
    props: {
        /** The full report result containing monitors data and timeRange */
        reportResult: {
            type: Object,
            required: true,
        },
    },
    computed: {
        /**
         * Whether there are monitors to display
         * @returns {boolean} True if monitors array has data
         */
        hasMonitors() {
            return this.reportResult && this.reportResult.monitors && this.reportResult.monitors.length > 0;
        },

        /**
         * Formatted shared time range label
         * @returns {string} Human-readable time range
         */
        formattedTimeRange() {
            if (!this.reportResult || !this.reportResult.timeRange) {
                return "";
            }
            const { start, end } = this.reportResult.timeRange;
            const startStr = dayjs.unix(start).format("YYYY-MM-DD HH:mm");
            const endStr = dayjs.unix(end).format("YYYY-MM-DD HH:mm");
            return startStr + " \u2014 " + endStr;
        },
    },
    methods: {
        /**
         * Get monitor name from root monitor list
         * @param {number} monitorId The monitor ID
         * @returns {string} Monitor name or fallback
         */
        monitorName(monitorId) {
            if (this.$root.monitorList && this.$root.monitorList[monitorId]) {
                return this.$root.monitorList[monitorId].name;
            }
            return "Monitor #" + monitorId;
        },

        /**
         * Format a duration in seconds to a human-readable string
         * @param {number} seconds Duration in seconds
         * @returns {string} Formatted duration (e.g. "2d 3h 15m")
         */
        formatDuration(seconds) {
            if (seconds === 0) {
                return "0s";
            }
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);

            const parts = [];
            if (days > 0) {
                parts.push(days + "d");
            }
            if (hours > 0) {
                parts.push(hours + "h");
            }
            if (minutes > 0) {
                parts.push(minutes + "m");
            }
            if (parts.length === 0 && secs > 0) {
                parts.push(secs + "s");
            }
            return parts.join(" ");
        },

        /**
         * Get CSS class for availability value based on threshold
         * @param {string} percentage Availability percentage string (e.g. "99.95")
         * @returns {string} CSS class name
         */
        availabilityClass(percentage) {
            const value = parseFloat(percentage);
            if (isNaN(value)) {
                return "";
            }
            if (value >= 99.9) {
                return "text-success";
            }
            if (value >= 99.0) {
                return "text-warning";
            }
            return "text-danger";
        },
    },
};
</script>
<style lang="scss" scoped>
.monitor-comparison-table {
    .comparison-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;

        h4 {
            margin-bottom: 0;
        }

        .time-range-label {
            font-size: 0.85rem;
            font-weight: normal;
        }
    }

    .empty-state {
        font-size: 0.95rem;
    }

    .table {
        .metric-header {
            min-width: 160px;
        }

        .metric-label {
            font-weight: 500;
        }

        .monitor-column {
            min-width: 120px;
        }

        .availability-value {
            font-weight: 600;
        }
    }
}
</style>
