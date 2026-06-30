const { describe, test } = require("node:test");
const assert = require("node:assert");

const { reportSocketHandler } = require("../../server/socket-handlers/report-socket-handler");

/**
 * Build a fake Socket.IO socket that records registered event handlers.
 * @param {object} props Extra properties to assign to the socket (e.g. userID).
 * @returns {{socket: object, handlers: object}} The fake socket and captured handlers.
 */
function makeFakeSocket(props = {}) {
    const handlers = {};
    const socket = {
        on(event, fn) {
            handlers[event] = fn;
        },
        ...props,
    };
    return { socket, handlers };
}

/**
 * Invoke a captured handler and resolve with its callback payload.
 * The report handlers use a trailing callback argument.
 * @param {Function} handler The captured socket handler.
 * @param {Array} args Leading arguments before the callback.
 * @returns {Promise<object>} The callback payload.
 */
function invoke(handler, args) {
    return new Promise((resolve) => {
        handler(...args, (res) => resolve(res));
    });
}

const reportEvents = [
    "generateReport",
    "exportReport",
    "getReportSchedules",
    "getReportSchedule",
    "addReportSchedule",
    "editReportSchedule",
    "deleteReportSchedule",
    "getReportRunLogs",
];

describe("report-socket-handler registration", () => {
    test("registers all report events", () => {
        const { socket, handlers } = makeFakeSocket();
        reportSocketHandler(socket);
        for (const event of reportEvents) {
            assert.strictEqual(typeof handlers[event], "function", `${event} should be registered`);
        }
    });
});

describe("report-socket-handler authentication", () => {
    // Feature: sla-report-module, Property 14: 未通过身份验证的报告事件被拒绝
    // Validates: Requirements 8.2
    test("Property 14: unauthenticated report events are rejected without running business logic", async () => {
        // No userID on the socket → checkLogin throws "You are not logged in."
        const { socket, handlers } = makeFakeSocket();
        reportSocketHandler(socket);

        // generateReport with an otherwise-valid request must be rejected by auth,
        // not by request validation — proving business logic never ran.
        const res = await invoke(handlers.generateReport, [
            { monitorIds: [1], periodType: "daily", referenceDate: 1705363200 },
        ]);
        assert.strictEqual(res.ok, false);
        assert.match(res.msg, /not logged in/i);
    });

    test("non-admin (unauthenticated) is rejected for every report event", async () => {
        const { socket, handlers } = makeFakeSocket();
        reportSocketHandler(socket);

        // Each event shape differs; provide minimal leading args before the callback.
        const argSets = {
            generateReport: [{ monitorIds: [1], periodType: "daily" }],
            exportReport: [{ reportRequest: { monitorIds: [1], periodType: "daily" }, format: "csv" }],
            getReportSchedules: [],
            getReportSchedule: [1],
            addReportSchedule: [{ name: "x" }],
            editReportSchedule: [1, { name: "x" }],
            deleteReportSchedule: [1],
            getReportRunLogs: [1],
        };

        for (const event of reportEvents) {
            const res = await invoke(handlers[event], argSets[event]);
            assert.strictEqual(res.ok, false, `${event} should be rejected`);
            assert.match(res.msg, /not logged in/i, `${event} should fail with auth error`);
        }
    });
});
