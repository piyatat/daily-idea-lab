import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMonitor, parseDuration } from "../src/model.js";

const monitor = {
  id: "invoice-sync",
  intervalMs: 60_000,
  graceMs: 10_000,
  createdAt: 1_000_000,
};

test("parses compact durations", () => {
  assert.equal(parseDuration("250ms"), 250);
  assert.equal(parseDuration("1.5m"), 90_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.throws(() => parseDuration("soon"), /Invalid duration/);
});

test("reports an open first window without a receipt baseline as unknown", () => {
  const status = evaluateMonitor(monitor, [], {
    now: monitor.createdAt + 30_000,
    continuitySince: monitor.createdAt,
  });
  assert.equal(status.state, "unknown");
  assert.match(status.detail, /Awaiting/);
});

test("keeps the window open at the exact deadline boundary", () => {
  const status = evaluateMonitor(monitor, [], {
    now: monitor.createdAt + 70_000,
    continuitySince: monitor.createdAt,
  });
  assert.equal(status.state, "unknown");
});

test("reports a continuously observed missed deadline as missing", () => {
  const status = evaluateMonitor(monitor, [], {
    now: monitor.createdAt + 71_000,
    continuitySince: monitor.createdAt,
  });
  assert.equal(status.state, "missing");
});

test("reports missing receiver continuity as unknown after restart", () => {
  const status = evaluateMonitor(monitor, [], {
    now: monitor.createdAt + 71_000,
    continuitySince: monitor.createdAt + 20_000,
  });
  assert.equal(status.state, "unknown");
});

test("reports a late first heartbeat", () => {
  const status = evaluateMonitor(
    monitor,
    [{ id: 1, receivedAt: monitor.createdAt + 71_000, duplicate: false }],
    {
      now: monitor.createdAt + 72_000,
      continuitySince: monitor.createdAt,
    },
  );
  assert.equal(status.state, "late");
});

test("reports duplicate delivery inside the current window", () => {
  const events = [
    { id: 1, receivedAt: monitor.createdAt + 30_000, duplicate: false },
    { id: 2, receivedAt: monitor.createdAt + 31_000, duplicate: true },
  ];
  const status = evaluateMonitor(monitor, events, {
    now: monitor.createdAt + 32_000,
    continuitySince: monitor.createdAt,
  });
  assert.equal(status.state, "duplicate");
  assert.equal(status.duplicateCount, 1);
});
