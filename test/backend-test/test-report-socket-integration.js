const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { R } = require("redbean-node");

const { reportSocketHandler } = require("../../server/socket-handlers/report-socket-handler");

const UP = 1;
const DOWN = 0;
const testDbPath = path.join(__dirname, "../../data/test-report-socket.db");

let httpServer;
let ioServer;
let client;
let monitorId;
const range = { start: 1705200000, end: 1705200000 + 3600 };

/**
 * Emit a socket event with a trailing acknowledgement callback and await the result.
 * @param {string} event Event name.
 * @param {*} payload Event payload.
 * @returns {Promise<object>} The acknowledgement payload.
 */
function emit(event, payload) {
    return new Promise((resolve) => {
        client.emit(event, payload, (res) => resolve(res));
    });
}

describe("report Socket.IO integration", () => {
    before(async () => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        const dir = path.dirname(testDbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const Dialect = require("knex/lib/dialects/sqlite3/index.js");
        Dialect.prototype._driver = () => require("@louislam/sqlite3");
        const knex = require("knex");
        R.setup(
            knex({
                client: Dialect,
                connection: { filename: testDbPath },
                useNullAsDefault: true,
            })
        );
        const { createTables } = require("../../db/knex_init_db.js");
        await createTables();
        await R.knex.migrate.latest({ directory: path.join(__dirname, "../../db/knex_migrations") });

        // Seed a monitor with a few heartbeats inside the range.
        await R.exec("INSERT INTO monitor (name) VALUES (?)", ["socket-monitor"]);
        monitorId = (await R.getRow("SELECT last_insert_rowid() AS id")).id;
        for (const [offset, status, ping] of [
            [100, UP, 40],
            [1200, DOWN, null],
            [2400, UP, 55],
        ]) {
            const time = dayjs.utc((range.start + offset) * 1000).format("YYYY-MM-DD HH:mm:ss.SSS");
            await R.exec("INSERT INTO heartbeat (monitor_id, status, time, ping) VALUES (?, ?, ?, ?)", [
                monitorId,
                status,
                time,
                ping,
            ]);
        }

        // Start an in-process Socket.IO server that authenticates connections and
        // registers the report handlers plus a lightweight echo event.
        httpServer = http.createServer();
        ioServer = new Server(httpServer);
        ioServer.on("connection", (socket) => {
            socket.userID = 1; // simulate an authenticated admin
            reportSocketHandler(socket);
            socket.on("echoTest", (payload, cb) => cb({ ok: true, echo: payload }));
        });

        await new Promise((resolve) => httpServer.listen(0, resolve));
        const port = httpServer.address().port;

        client = ioClient(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true });
        await new Promise((resolve, reject) => {
            client.on("connect", resolve);
            client.on("connect_error", reject);
        });
    });

    after(async () => {
        if (client) {
            client.disconnect();
        }
        if (ioServer) {
            await new Promise((resolve) => ioServer.close(resolve));
        }
        if (httpServer && httpServer.listening) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
        await R.knex.destroy();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    // 16.1: exchange Report_Request / Report_Result over Socket.IO.
    test("exchanges a report request and result over Socket.IO", async () => {
        const res = await emit("generateReport", {
            monitorIds: [monitorId],
            periodType: "custom",
            start: range.start,
            end: range.end,
        });

        assert.strictEqual(res.ok, true, res.msg);
        assert.ok(res.reportResult, "reportResult should be present");
        assert.strictEqual(res.reportResult.monitors.length, 1);
        assert.strictEqual(res.reportResult.monitors[0].monitorId, monitorId);
    });

    // 16.4: concurrent report generation must not block other Socket.IO events.
    test("handles concurrent report generation without blocking other events", async () => {
        const reportRequest = {
            monitorIds: [monitorId],
            periodType: "custom",
            start: range.start,
            end: range.end,
        };

        const calls = [];
        for (let i = 0; i < 5; i++) {
            calls.push(emit("generateReport", reportRequest));
        }
        // Interleave a lightweight event that must still receive a timely response.
        calls.push(emit("echoTest", { n: 42 }));

        const results = await Promise.all(calls);

        const echo = results[results.length - 1];
        assert.strictEqual(echo.ok, true);
        assert.strictEqual(echo.echo.n, 42, "echo event must respond even during report generation");

        for (let i = 0; i < 5; i++) {
            assert.strictEqual(results[i].ok, true, "each concurrent report should succeed");
        }
    });
});
