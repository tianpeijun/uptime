<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ isEdit ? $t("Edit Schedule") : $t("Add Schedule") }}</h1>
            <form @submit.prevent="submit">
                <div class="shadow-box shadow-box-with-fixed-bottom-bar">
                    <div class="row">
                        <div class="col-xl-10">
                            <!-- Name -->
                            <div class="mb-3">
                                <label for="schedule-name" class="form-label">{{ $t("Schedule Name") }}</label>
                                <input
                                    id="schedule-name"
                                    v-model="schedule.name"
                                    type="text"
                                    class="form-control"
                                    required
                                />
                            </div>

                            <!-- Monitors -->
                            <div class="mb-3">
                                <label class="form-label">{{ $t("Monitors") }}</label>
                                <VueMultiselect
                                    v-model="selectedMonitors"
                                    :options="monitorOptions"
                                    track-by="id"
                                    label="pathName"
                                    :multiple="true"
                                    :close-on-select="false"
                                    :clear-on-select="false"
                                    :preserve-search="true"
                                    :placeholder="$t('Pick Affected Monitors...')"
                                    :preselect-first="false"
                                    :max-height="600"
                                    :taggable="false"
                                />
                            </div>

                            <!-- Period Type -->
                            <div class="mb-3">
                                <label for="period-type" class="form-label">{{ $t("Period Type") }}</label>
                                <select id="period-type" v-model="schedule.period_type" class="form-select" required>
                                    <option value="daily">daily</option>
                                    <option value="weekly">weekly</option>
                                    <option value="monthly">monthly</option>
                                    <option value="custom">custom</option>
                                </select>
                            </div>

                            <!-- Cron Expression -->
                            <div class="mb-3">
                                <label for="cron-expression" class="form-label">{{ $t("cronExpression") }}</label>
                                <input
                                    id="cron-expression"
                                    v-model="schedule.cron_expression"
                                    type="text"
                                    class="form-control"
                                    required
                                />
                            </div>

                            <!-- Export Format -->
                            <div class="mb-3">
                                <label for="export-format" class="form-label">{{ $t("Export Format") }}</label>
                                <select
                                    id="export-format"
                                    v-model="schedule.export_format"
                                    class="form-select"
                                    required
                                >
                                    <option value="pdf">PDF</option>
                                    <option value="csv">CSV</option>
                                </select>
                            </div>

                            <!-- Enable Email -->
                            <div class="mb-3">
                                <div class="form-check form-switch">
                                    <input
                                        id="enable-email"
                                        v-model="schedule.emailEnabled"
                                        class="form-check-input"
                                        type="checkbox"
                                    />
                                    <label class="form-check-label" for="enable-email">
                                        {{ $t("Enable Email") }}
                                    </label>
                                </div>
                            </div>

                            <!-- Email Recipients -->
                            <div v-if="schedule.emailEnabled" class="mb-3">
                                <label for="smtp-notification" class="form-label">{{ $t("Notifications") }}</label>
                                <select
                                    id="smtp-notification"
                                    v-model="schedule.smtpNotificationId"
                                    class="form-select"
                                    :required="schedule.emailEnabled"
                                >
                                    <option :value="null" disabled>{{ $t("reportSelectNotification") }}</option>
                                    <option v-for="n in smtpNotifications" :key="n.id" :value="n.id">
                                        {{ n.name }}
                                    </option>
                                </select>
                            </div>

                            <!-- Email Recipients -->
                            <div v-if="schedule.emailEnabled" class="mb-3">
                                <label for="recipients" class="form-label">{{ $t("Email Recipients") }}</label>
                                <input
                                    id="recipients"
                                    v-model="schedule.recipients"
                                    type="text"
                                    class="form-control"
                                    :required="schedule.emailEnabled"
                                />
                                <div class="form-text">{{ $t("recipientsHelp") }}</div>
                            </div>

                            <!-- SMTP Validation Error -->
                            <div v-if="smtpError" class="alert alert-danger">
                                {{ $t("smtpNotConfigured") }}
                            </div>

                            <!-- Active -->
                            <div class="mb-3">
                                <div class="form-check form-switch">
                                    <input
                                        id="active"
                                        v-model="schedule.active"
                                        class="form-check-input"
                                        type="checkbox"
                                    />
                                    <label class="form-check-label" for="active">
                                        {{ $t("Active") }}
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4">
                        <button class="btn btn-primary" type="submit" :disabled="processing">
                            <span
                                v-if="processing"
                                class="spinner-border spinner-border-sm me-1"
                                role="status"
                                aria-hidden="true"
                            ></span>
                            {{ $t("Save") }}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </transition>
</template>

<script>
import VueMultiselect from "vue-multiselect";

export default {
    components: {
        VueMultiselect,
    },
    data() {
        return {
            schedule: {
                name: "",
                period_type: "daily",
                cron_expression: "0 8 * * *",
                export_format: "pdf",
                emailEnabled: false,
                smtpNotificationId: null,
                recipients: "",
                active: true,
            },
            selectedMonitors: [],
            processing: false,
            smtpError: false,
        };
    },
    computed: {
        isEdit() {
            return this.$route.params.id != null;
        },
        monitorOptions() {
            return Object.values(this.$root.monitorList).map((m) => ({
                id: m.id,
                pathName: m.pathName || m.name,
            }));
        },

        /**
         * SMTP-type notifications available for report email delivery.
         * @returns {Array<object>} Notifications whose config type is "smtp".
         */
        smtpNotifications() {
            return (this.$root.notificationList || []).filter((n) => {
                try {
                    return JSON.parse(n.config).type === "smtp";
                } catch (e) {
                    return false;
                }
            });
        },
    },
    mounted() {
        if (this.isEdit) {
            this.loadSchedule();
        }
    },
    methods: {
        loadSchedule() {
            this.$root.getReportSchedule(this.$route.params.id, (res) => {
                if (res.ok) {
                    const s = res.schedule;
                    this.schedule = {
                        name: s.name,
                        period_type: s.periodType,
                        cron_expression: s.cronExpression,
                        export_format: s.exportFormat,
                        emailEnabled: !!s.smtpNotificationId,
                        smtpNotificationId: s.smtpNotificationId || null,
                        recipients: Array.isArray(s.recipients) ? s.recipients.join(", ") : s.recipients || "",
                        active: s.active,
                    };
                    if (s.monitorIds && Array.isArray(s.monitorIds)) {
                        this.selectedMonitors = s.monitorIds
                            .map((id) => this.monitorOptions.find((m) => m.id === id))
                            .filter(Boolean);
                    }
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        submit() {
            this.smtpError = false;
            this.processing = true;
            const data = {
                name: this.schedule.name,
                periodType: this.schedule.period_type,
                cronExpression: this.schedule.cron_expression,
                exportFormat: this.schedule.export_format,
                active: this.schedule.active,
                emailEnabled: this.schedule.emailEnabled,
                smtpNotificationId: this.schedule.emailEnabled ? this.schedule.smtpNotificationId : null,
                monitorIds: this.selectedMonitors.map((m) => m.id),
                recipients: this.schedule.emailEnabled
                    ? this.schedule.recipients
                          .split(",")
                          .map((e) => e.trim())
                          .filter(Boolean)
                    : [],
            };
            const callback = (res) => {
                this.processing = false;
                if (res.ok) {
                    this.$root.toastRes(res);
                    this.$router.push("/report-schedules");
                } else {
                    if (res.msg && res.msg.includes("SMTP")) {
                        this.smtpError = true;
                    }
                    this.$root.toastError(res.msg);
                }
            };
            if (this.isEdit) {
                this.$root.editReportSchedule(this.$route.params.id, data, callback);
            } else {
                this.$root.addReportSchedule(data, callback);
            }
        },
    },
};
</script>
