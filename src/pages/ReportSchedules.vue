<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">
                {{ $t("Report Schedules") }}
            </h1>

            <!-- Run Logs View -->
            <div v-if="showRunLogs" class="mb-4">
                <div class="d-flex align-items-center mb-3">
                    <button class="btn btn-outline-secondary me-2" @click="closeRunLogs">
                        <font-awesome-icon icon="arrow-left" />
                        {{ $t("Back") }}
                    </button>
                    <h5 class="mb-0">
                        {{ $t("scheduleRunLogTitle", { name: selectedScheduleName }) }}
                    </h5>
                </div>
                <div class="shadow-box">
                    <span v-if="runLogs.length === 0" class="d-flex align-items-center justify-content-center my-3">
                        {{ $t("noRunLogs") }}
                    </span>
                    <table v-else class="table">
                        <thead>
                            <tr>
                                <th>{{ $t("Run Time") }}</th>
                                <th>{{ $t("Status") }}</th>
                                <th>{{ $t("Message") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="log in runLogs" :key="log.id">
                                <td>{{ log.run_time }}</td>
                                <td>
                                    <span class="badge" :class="log.status === 'success' ? 'bg-success' : 'bg-danger'">
                                        {{ log.status }}
                                    </span>
                                </td>
                                <td>{{ log.message || "-" }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Schedule List -->
            <div v-else>
                <div>
                    <router-link to="/report-schedules/add" class="btn btn-primary mb-3">
                        <font-awesome-icon icon="plus" />
                        {{ $t("Add Schedule") }}
                    </router-link>
                </div>
                <div class="shadow-box">
                    <span v-if="schedules.length === 0" class="d-flex align-items-center justify-content-center my-3">
                        {{ $t("No Schedules") }}
                    </span>
                    <div v-for="item in schedules" :key="item.id" class="item">
                        <div class="row align-items-center w-100">
                            <div class="col">
                                <div class="title">{{ item.name }}</div>
                                <div class="small text-muted">
                                    {{ $t("Period Type") }}: {{ item.periodType }}
                                    &middot;
                                    {{ item.active ? $t("Active") : $t("Inactive") }}
                                </div>
                            </div>
                            <div class="col-auto">
                                <div class="btn-group" role="group">
                                    <button class="btn btn-normal" @click="viewRunLogs(item)">
                                        <font-awesome-icon icon="list" />
                                        {{ $t("Run Logs") }}
                                    </button>
                                    <router-link :to="'/report-schedules/edit/' + item.id" class="btn btn-normal">
                                        <font-awesome-icon icon="edit" />
                                        {{ $t("Edit") }}
                                    </router-link>
                                    <button class="btn btn-normal text-danger" @click="deleteDialog(item.id)">
                                        <font-awesome-icon icon="trash" />
                                        {{ $t("Delete") }}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <Confirm
                ref="confirmDelete"
                btn-style="btn-danger"
                :yes-text="$t('Yes')"
                :no-text="$t('No')"
                @yes="deleteSchedule"
            >
                {{ $t("deleteScheduleMsg") }}
            </Confirm>
        </div>
    </transition>
</template>

<script>
import Confirm from "../components/Confirm.vue";

export default {
    components: {
        Confirm,
    },
    data() {
        return {
            schedules: [],
            showRunLogs: false,
            runLogs: [],
            selectedScheduleName: "",
            selectedDeleteId: null,
        };
    },
    mounted() {
        this.loadSchedules();
    },
    methods: {
        /**
         * Load all report schedules from server
         * @returns {void}
         */
        loadSchedules() {
            this.$root.getReportSchedules((res) => {
                if (res.ok) {
                    this.schedules = res.schedules;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * View run logs for a schedule
         * @param {object} item The schedule item
         * @returns {void}
         */
        viewRunLogs(item) {
            this.selectedScheduleName = item.name;
            this.$root.getReportRunLogs(item.id, (res) => {
                if (res.ok) {
                    this.runLogs = res.logs;
                    this.showRunLogs = true;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Close run logs view and return to schedule list
         * @returns {void}
         */
        closeRunLogs() {
            this.showRunLogs = false;
            this.runLogs = [];
            this.selectedScheduleName = "";
        },

        /**
         * Show delete confirmation dialog
         * @param {number} id Schedule ID to delete
         * @returns {void}
         */
        deleteDialog(id) {
            this.selectedDeleteId = id;
            this.$refs.confirmDelete.show();
        },

        /**
         * Delete the selected schedule
         * @returns {void}
         */
        deleteSchedule() {
            this.$root.deleteReportSchedule(this.selectedDeleteId, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadSchedules();
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.item {
    display: flex;
    align-items: center;
    padding: 14px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);

    &:last-child {
        border-bottom: none;
    }
}

.dark .item {
    border-bottom-color: rgba(255, 255, 255, 0.05);
}

.title {
    font-weight: bold;
}
</style>
