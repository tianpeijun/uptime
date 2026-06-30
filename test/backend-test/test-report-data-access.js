const { describe, test, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { R } = require("redbean-node");

const { fetchHeartbeats } = require("../../server/report/report-data-access");

describe("fetchHeartbeats", () => {
    let originalGetAll;

    beforeEach(() => {
        originalGetAll = R.getAll;
    });

    afterEach(() => {
        R.getAll = originalGetAll;
    });

    test("should query with correct SQL and parameters", async () => {
        let capturedSql = "";
        let capturedParams = [];

        R.getAll = async (sql, params) => {
            capturedSql = sql;
            capturedParams = params;
            return [];
        };

        // Unix timestamp: 2024-01-15 00:00:00 UTC = 1705276800
        // Unix timestamp: 2024-01-16 00:00:00 UTC = 1705363200
        await fetchHeartbeats(42, { start: 1705276800, end: 1705363200 });

        assert.ok(capturedSql.includes("SELECT * FROM heartbeat"), "SQL should select from heartbeat");
        assert.ok(capturedSql.includes("monitor_id = ?"), "SQL should filter by monitor_id");
        assert.ok(capturedSql.includes("time >= ?"), "SQL should filter by start time");
        assert.ok(capturedSql.includes("time <= ?"), "SQL should filter by end time");
        assert.ok(capturedSql.includes("ORDER BY time ASC"), "SQL should order by time ascending");

        assert.strictEqual(capturedParams[0], 42, "First param should be monitorId");
        assert.strictEqual(capturedParams[1], "2024-01-15 00:00:00.000", "Second param should be start time");
        assert.strictEqual(capturedParams[2], "2024-01-16 00:00:00.000", "Third param should be end time");
    });

    test("should return rows from R.getAll", async () => {
        const fakeRows = [
            { id: 1, monitor_id: 1, status: 1, time: "2024-01-15 01:00:00.000", ping: 50 },
            { id: 2, monitor_id: 1, status: 0, time: "2024-01-15 02:00:00.000", ping: null },
        ];

        R.getAll = async () => fakeRows;

        const result = await fetchHeartbeats(1, { start: 1705276800, end: 1705363200 });
        assert.deepStrictEqual(result, fakeRows);
    });

    test("should return empty array when no heartbeats exist", async () => {
        R.getAll = async () => [];

        const result = await fetchHeartbeats(99, { start: 1705276800, end: 1705363200 });
        assert.deepStrictEqual(result, []);
    });

    test("should correctly format timestamps with millisecond precision", async () => {
        let capturedParams = [];

        R.getAll = async (sql, params) => {
            capturedParams = params;
            return [];
        };

        // 2024-06-15 13:30:45 UTC = 1718455845
        await fetchHeartbeats(1, { start: 1718455845, end: 1718459445 });

        // Verify the format matches YYYY-MM-DD HH:mm:ss.SSS
        const timeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
        assert.match(capturedParams[1], timeRegex, "Start time should match YYYY-MM-DD HH:mm:ss.SSS format");
        assert.match(capturedParams[2], timeRegex, "End time should match YYYY-MM-DD HH:mm:ss.SSS format");
    });

    test("should be read-only (no INSERT/UPDATE/DELETE in SQL)", async () => {
        let capturedSql = "";

        R.getAll = async (sql) => {
            capturedSql = sql;
            return [];
        };

        await fetchHeartbeats(1, { start: 1705276800, end: 1705363200 });

        const upperSql = capturedSql.toUpperCase();
        assert.ok(!upperSql.includes("INSERT"), "SQL should not contain INSERT");
        assert.ok(!upperSql.includes("UPDATE"), "SQL should not contain UPDATE");
        assert.ok(!upperSql.includes("DELETE"), "SQL should not contain DELETE");
    });
});
