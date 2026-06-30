<template>
    <div class="response-time-chart">
        <h6 class="chart-title">{{ $t("Response Time Trend") }}</h6>
        <div v-if="hasData" class="chart-wrapper">
            <Line :data="chartData" :options="chartOptions" />
        </div>
        <div v-else class="empty-state text-center text-muted py-4">
            {{ $t("No data available for chart") }}
        </div>
    </div>
</template>

<script lang="js">
import {
    Chart,
    Filler,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    TimeScale,
    Tooltip,
    Legend,
} from "chart.js";
import "chartjs-adapter-dayjs-4";
import { Line } from "vue-chartjs";

Chart.register(LineController, LineElement, PointElement, TimeScale, LinearScale, Tooltip, Filler, Legend);

export default {
    components: { Line },
    props: {
        /**
         * Array of data points for the response time chart.
         * Each item: { time: number (unix seconds), min: number|null, avg: number|null, max: number|null }
         * where values are in milliseconds, or null for missing data.
         */
        dataPoints: {
            type: Array,
            default: () => [],
        },
    },
    computed: {
        /**
         * Whether there is data to display.
         * @returns {boolean} true if dataPoints contains at least one non-null avg value
         */
        hasData() {
            return (
                this.dataPoints &&
                this.dataPoints.length > 0 &&
                this.dataPoints.some((p) => p.avg !== null && p.avg !== undefined)
            );
        },

        /**
         * Build chart.js data configuration from dataPoints prop.
         * Creates three line datasets for min, avg, and max response times.
         * @returns {object} chart.js data object with datasets
         */
        chartData() {
            const minData = this.dataPoints.map((p) => ({
                x: new Date(p.time * 1000),
                y: p.min !== null && p.min !== undefined ? p.min : null,
            }));
            const avgData = this.dataPoints.map((p) => ({
                x: new Date(p.time * 1000),
                y: p.avg !== null && p.avg !== undefined ? p.avg : null,
            }));
            const maxData = this.dataPoints.map((p) => ({
                x: new Date(p.time * 1000),
                y: p.max !== null && p.max !== undefined ? p.max : null,
            }));

            return {
                datasets: [
                    {
                        label: this.$t("minPing"),
                        data: minData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#126331",
                        backgroundColor: "#2F9C5914",
                        pointRadius: 0,
                        pointHitRadius: 100,
                    },
                    {
                        label: this.$t("avgPing"),
                        data: avgData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#5CDD8B",
                        backgroundColor: "#5CDD8B06",
                        pointRadius: 0,
                        pointHitRadius: 100,
                    },
                    {
                        label: this.$t("maxPing"),
                        data: maxData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#21b55a",
                        backgroundColor: "#1E7A4214",
                        pointRadius: 0,
                        pointHitRadius: 100,
                    },
                ],
            };
        },

        /**
         * Chart.js options for the response time line chart.
         * Uses a time-based x-axis and millisecond y-axis.
         * @returns {object} chart.js options object
         */
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false,
                },
                elements: {
                    point: {
                        radius: 0,
                        hitRadius: 100,
                    },
                },
                scales: {
                    x: {
                        type: "time",
                        time: {
                            minUnit: "minute",
                            round: "second",
                            tooltipFormat: "YYYY-MM-DD HH:mm:ss",
                            displayFormats: {
                                minute: "HH:mm",
                                hour: "MM-DD HH:mm",
                                day: "MM-DD",
                            },
                        },
                        ticks: {
                            sampleSize: 3,
                            maxRotation: 0,
                            autoSkipPadding: 30,
                        },
                        grid: {
                            color: this.$root.theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)",
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: this.$t("respTime"),
                        },
                        beginAtZero: true,
                        grid: {
                            color: this.$root.theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)",
                        },
                    },
                },
                plugins: {
                    tooltip: {
                        mode: "nearest",
                        intersect: false,
                        padding: 10,
                        callbacks: {
                            label: (context) => {
                                if (context.parsed.y === null) {
                                    return context.dataset.label + ": " + this.$t("notAvailableShort");
                                }
                                return (
                                    context.dataset.label +
                                    " " +
                                    new Intl.NumberFormat().format(context.parsed.y) +
                                    " ms"
                                );
                            },
                        },
                    },
                    legend: {
                        display: true,
                        position: "top",
                        labels: {
                            color: this.$root.theme === "light" ? "rgba(12,12,18,1.0)" : "rgba(220,220,220,1.0)",
                        },
                    },
                },
            };
        },
    },
};
</script>

<style lang="scss" scoped>
.response-time-chart {
    margin-bottom: 1rem;

    .chart-title {
        margin-bottom: 0.5rem;
    }

    .chart-wrapper {
        position: relative;
        height: 250px;
    }

    .empty-state {
        border: 1px dashed rgba(0, 0, 0, 0.2);
        border-radius: 0.5rem;

        .dark & {
            border-color: rgba(255, 255, 255, 0.2);
        }
    }
}
</style>
