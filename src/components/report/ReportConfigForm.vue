<template>
    <form @submit.prevent="submit">
        <!-- Monitor Selection (multi-select) -->
        <div class="mb-3">
            <label for="report-monitors" class="form-label">{{ $t("Select Monitors") }}</label>
            <VueMultiselect
                id="report-monitors"
                v-model="selectedMonitors"
                :options="monitorOptions"
                :multiple="true"
                :close-on-select="false"
                :clear-on-select="false"
                :preserve-search="true"
                :placeholder="$t('reportSelectMonitorsPlaceholder')"
                label="name"
                track-by="id"
            />
        </div>

        <!-- Period Type -->
        <div class="mb-3">
            <label for="report-period-type" class="form-label">{{ $t("Period Type") }}</label>
            <select id="report-period-type" v-model="periodType" class="form-select" required>
                <option value="daily">{{ $t("Daily") }}</option>
                <option value="weekly">{{ $t("Weekly") }}</option>
                <option value="monthly">{{ $t("Monthly") }}</option>
                <option value="custom">{{ $t("Custom") }}</option>
            </select>
        </div>

        <!-- Custom Date Range -->
        <template v-if="periodType === 'custom'">
            <div class="mb-3">
                <label for="report-start-date" class="form-label">{{ $t("Start Date") }}</label>
                <Datepicker
                    id="report-start-date"
                    v-model="startDate"
                    :dark="$root.isDark"
                    :month-change-on-scroll="false"
                    format="yyyy-MM-dd HH:mm"
                    model-type="yyyy-MM-dd HH:mm:ss"
                    :required="periodType === 'custom'"
                />
            </div>
            <div class="mb-3">
                <label for="report-end-date" class="form-label">{{ $t("End Date") }}</label>
                <Datepicker
                    id="report-end-date"
                    v-model="endDate"
                    :dark="$root.isDark"
                    :month-change-on-scroll="false"
                    format="yyyy-MM-dd HH:mm"
                    model-type="yyyy-MM-dd HH:mm:ss"
                    :required="periodType === 'custom'"
                />
            </div>
        </template>

        <!-- Export Format -->
        <div class="mb-3">
            <label for="report-export-format" class="form-label">{{ $t("Export Format") }}</label>
            <select id="report-export-format" v-model="exportFormat" class="form-select">
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
            </select>
        </div>

        <!-- Submit -->
        <button type="submit" class="btn btn-primary" :disabled="processing">
            <span
                v-if="processing"
                class="spinner-border spinner-border-sm me-1"
                role="status"
                aria-hidden="true"
            ></span>
            {{ $t("Generate Report") }}
        </button>
    </form>
</template>

<script>
import VueMultiselect from "vue-multiselect";
import Datepicker from "@vuepic/vue-datepicker";
import dayjs from "dayjs";

export default {
    components: {
        VueMultiselect,
        Datepicker,
    },

    emits: ["generate"],

    data() {
        return {
            selectedMonitors: [],
            periodType: "daily",
            startDate: null,
            endDate: null,
            exportFormat: "csv",
            processing: false,
        };
    },

    computed: {
        /**
         * Build an options array from the global monitor list for the multiselect.
         * @returns {void}
         */
        monitorOptions() {
            const list = this.$root.monitorList;
            if (!list) {
                return [];
            }
            return Object.values(list).map((m) => ({
                id: m.id,
                name: m.name,
            }));
        },
    },

    methods: {
        /**
         * Build Report_Request and emit via generateReport socket event.
         * @returns {void}
         */
        submit() {
            if (this.selectedMonitors.length === 0) {
                this.$root.toastError(this.$t("reportSelectMonitorsRequired"));
                return;
            }

            if (this.periodType === "custom") {
                if (!this.startDate) {
                    this.$root.toastError(this.$t("reportStartDateRequired"));
                    return;
                }
                if (!this.endDate) {
                    this.$root.toastError(this.$t("reportEndDateRequired"));
                    return;
                }
            }

            const reportRequest = {
                monitorIds: this.selectedMonitors.map((m) => m.id),
                periodType: this.periodType,
            };

            if (this.periodType === "custom") {
                reportRequest.start = dayjs(this.startDate).unix();
                reportRequest.end = dayjs(this.endDate).unix();
            } else {
                reportRequest.referenceDate = dayjs().unix();
            }

            this.processing = true;
            this.$root.getSocket().emit("generateReport", reportRequest, (res) => {
                this.processing = false;
                if (res.ok) {
                    this.$emit("generate", {
                        reportResult: res.reportResult,
                        reportRequest,
                        exportFormat: this.exportFormat,
                    });
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.form-label {
    font-weight: 600;
}
</style>
