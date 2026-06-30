<template>
    <div class="availability-chart">
        <h6 class="chart-title">{{ $t("Availability Over Time") }}</h6>
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
         * Array of data points for the availability chart.
         * Each item: { time: number (unix seconds), availability: number (0-100) | null }
         */
        dataPoints: {
            type: Array,
            default: () => [],
        },
    },
    computed: {
        /**
         * Whether there is data to display.
         * @returns {boolean} true if dataPoints contains at least one non-null availability value
         */
        hasData() {
            return (
                this.dataPoints &&
                this.dataPoints.length > 0 &&
                this.dataPoints.some((p) => p.availability !== null && p.availability !== undefined)
            );
        },

        /**
         * Build chart.js data configuration from dataPoints prop.
         * Maps unix-second timestamps to Date objects for the time axis.
         * @returns {object} chart.js data object with datasets
         */
        chartData() {
            const points = this.dataPoints.map((p) => ({
                x: new Date(p.time * 1000),
                y: p.availability !== null && p.availability !== undefined ? p.availability : null,
            }));

            return {
                datasets: [
                    {
                        label: this.$t("Availability (%)"),
                        data: points,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#4ABF74",
                        backgroundColor: "#4ABF7438",
                        pointRadius: 0,
                        pointHitRadius: 100,
                        spanGaps: false,
                    },
                ],
            };
        },

        /**
         * Chart.js options for the availability line chart.
         * Uses a time-based x-axis and a 0-100 percentage y-axis.
         * @returns {object} chart.js options object
         */
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
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
                            text: this.$t("Availability (%)"),
                        },
                        min: 0,
                        max: 100,
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
                                    return this.$t("notAvailableShort");
                                }
                                return context.dataset.label + ": " + context.parsed.y.toFixed(2) + "%";
                            },
                        },
                    },
                    legend: {
                        display: false,
                    },
                },
            };
        },
    },
};
</script>

<style lang="scss" scoped>
.availability-chart {
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
