exports.up = function (knex) {
    return knex.schema
        .createTable("report_schedule", function (table) {
            table.increments("id");
            table.string("name", 255).notNullable();
            table.string("cron_expression", 255).notNullable();
            table.string("period_type", 20).notNullable();
            table.string("export_format", 10).notNullable();
            table.text("recipients").notNullable();
            table.integer("smtp_notification_id").nullable();
            table.boolean("active").notNullable().defaultTo(true);
            table.datetime("created_date").nullable();
            table.datetime("updated_date").nullable();
        })
        .createTable("report_schedule_monitor", function (table) {
            table.increments("id");
            table.integer("schedule_id").notNullable().index();
            table.integer("monitor_id").notNullable().index();
        })
        .createTable("report_run_log", function (table) {
            table.increments("id");
            table.integer("schedule_id").notNullable().index();
            table.string("status", 20).notNullable();
            table.text("message").nullable();
            table.datetime("run_time").notNullable();
        });
};

exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists("report_run_log")
        .dropTableIfExists("report_schedule_monitor")
        .dropTableIfExists("report_schedule");
};
