<template>
    <div class="incident-timeline">
        <h5 class="incident-timeline-title">{{ $t("Incident Timeline") }}</h5>

        <!-- Empty state: no incidents -->
        <div v-if="incidents.length === 0" class="empty-state text-center py-4">
            <span class="text-muted">{{ $t("noIncidentsInRange") }}</span>
        </div>

        <!-- Incident list -->
        <div v-else class="incident-timeline-list">
            <div v-for="(incident, index) in incidents" :key="index" class="incident-timeline-item">
                <div class="incident-timeline-indicator"></div>
                <div class="incident-timeline-body">
                    <div class="incident-timeline-row">
                        <span class="incident-timeline-label">{{ $t("incidentStart") }}:</span>
                        <span class="incident-timeline-value">{{ formatTime(incident.start) }}</span>
                    </div>
                    <div class="incident-timeline-row">
                        <span class="incident-timeline-label">{{ $t("incidentEnd") }}:</span>
                        <span class="incident-timeline-value">
                            {{ incident.end ? formatTime(incident.end) : $t("incidentOngoing") }}
                        </span>
                    </div>
                    <div class="incident-timeline-row">
                        <span class="incident-timeline-label">{{ $t("incidentDuration") }}:</span>
                        <span class="incident-timeline-value">
                            {{ formatDuration(incident.duration) }}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import datetimeMixin from "../../mixins/datetime";
import { timeDurationFormatter } from "../../util-frontend.js";

export default {
    name: "IncidentTimeline",
    mixins: [datetimeMixin],
    props: {
        /**
         * Array of incident objects.
         * Each incident has: { start: number (unix seconds), end: number|null, duration: number|null (seconds) }
         */
        incidents: {
            type: Array,
            default: () => [],
        },
    },
    methods: {
        /**
         * Format a Unix timestamp for display.
         * @param {number} ts Unix timestamp in seconds.
         * @returns {string} Formatted datetime string.
         */
        formatTime(ts) {
            if (ts == null) {
                return "-";
            }
            return this.unixToDateTime(ts);
        },

        /**
         * Format a duration in seconds to a human-readable string.
         * @param {number|null} seconds Duration in seconds.
         * @returns {string} Formatted duration or dash if null.
         */
        formatDuration(seconds) {
            if (seconds == null) {
                return "-";
            }
            return timeDurationFormatter.secondsToHumanReadableFormat(seconds);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.incident-timeline {
    padding: 10px 0;

    .incident-timeline-title {
        margin-bottom: 12px;
        font-size: 1rem;
        font-weight: 600;
    }

    .empty-state {
        border: 1px dashed $dark-border-color;
        border-radius: 8px;
        padding: 24px;
    }

    .incident-timeline-list {
        .incident-timeline-item {
            display: flex;
            align-items: flex-start;
            padding: 10px 12px;
            margin-bottom: 8px;
            border-radius: 8px;
            background-color: rgba(220, 53, 69, 0.05);
            border-left: 4px solid $danger;

            .incident-timeline-indicator {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background-color: $danger;
                margin-top: 5px;
                margin-right: 12px;
                flex-shrink: 0;
            }

            .incident-timeline-body {
                flex: 1;

                .incident-timeline-row {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 2px;
                    font-size: 0.875rem;

                    .incident-timeline-label {
                        font-weight: 500;
                        color: inherit;
                        opacity: 0.7;
                        min-width: 70px;
                    }

                    .incident-timeline-value {
                        font-family: monospace;
                    }
                }
            }
        }
    }
}

.dark {
    .incident-timeline {
        .empty-state {
            border-color: $dark-border-color;
        }

        .incident-timeline-list {
            .incident-timeline-item {
                background-color: rgba(220, 53, 69, 0.1);
            }
        }
    }
}
</style>
