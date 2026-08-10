import assert from "node:assert/strict";
import test from "node:test";
import { openStore } from "../src/db.js";
import { createOpsServer } from "../src/server.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("authenticates receipts, hashes event IDs, and detects duplicates", async (t) => {
  let now = 1_000_000;
  const store = openStore(":memory:");
  const monitor = store.createMonitor({
    id: "invoice-sync",
    intervalMs: 60_000,
    graceMs: 10_000,
    now,
  });
  const { server } = createOpsServer({
    store,
    clock: () => now,
    continuitySince: now,
    continuityGapMs: Number.POSITIVE_INFINITY,
  });
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  const endpoint = `${baseUrl}/api/heartbeat/invoice-sync`;
  const missing = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: "Bearer wrong-token" },
  });
  assert.equal(missing.status, 404);

  const first = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${monitor.token}`,
      "x-ops-event-id": "customer-visible-run-42",
    },
  });
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), {
    observed: true,
    duplicate: false,
    receivedAt: now,
    note: "Receipt observed; workflow correctness was not evaluated.",
  });

  now += 1_000;
  const second = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${monitor.token}`,
      "x-ops-event-id": "customer-visible-run-42",
    },
  });
  assert.equal(second.status, 202);
  assert.equal((await second.json()).duplicate, true);

  const payloadRejected = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${monitor.token}` },
    body: "sensitive payload that must not be retained",
  });
  assert.equal(payloadRejected.status, 413);

  const oversized = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${monitor.token}` },
    body: "x".repeat(64 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);

  const events = store.listEvents("invoice-sync");
  assert.equal(events.length, 2);
  assert.notEqual(events[0].eventDigest, "customer-visible-run-42");
  assert.equal(events[0].eventDigest, events[1].eventDigest);
  assert.equal(events[1].duplicate, true);

  const dashboardData = await fetch(`${baseUrl}/api/monitors`).then((response) => response.json());
  assert.equal(dashboardData.monitors[0].state, "duplicate");
  assert.doesNotMatch(JSON.stringify(dashboardData), /sensitive payload|customer-visible-run-42/);
});

test("classifies a missed window only with continuous receiver uptime", async (t) => {
  let now = 5_000_000;
  const store = openStore(":memory:");
  store.createMonitor({
    id: "daily-export",
    intervalMs: 60_000,
    graceMs: 10_000,
    now,
  });
  const { server } = createOpsServer({
    store,
    clock: () => now,
    continuitySince: now,
    continuityGapMs: Number.POSITIVE_INFINITY,
  });
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  now += 70_001;
  const data = await fetch(`${baseUrl}/api/monitors`).then((response) => response.json());
  assert.equal(data.monitors[0].state, "missing");
  assert.match(data.monitors[0].detail, /not observed/);
});

test("resets continuity after an observation gap", async (t) => {
  let now = 7_000_000;
  const store = openStore(":memory:");
  store.createMonitor({
    id: "paused-receiver",
    intervalMs: 60_000,
    graceMs: 10_000,
    now,
  });
  const { server } = createOpsServer({
    store,
    clock: () => now,
    continuitySince: now,
    continuityGapMs: 5_000,
  });
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  now += 70_001;
  const data = await fetch(`${baseUrl}/api/monitors`).then((response) => response.json());
  assert.equal(data.monitors[0].state, "unknown");
  assert.equal(data.continuitySince, now);
});

test("serves a self-contained dashboard and health endpoint", async (t) => {
  const store = openStore(":memory:");
  const { server } = createOpsServer({ store, clock: () => 123, continuitySince: 123 });
  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  const dashboard = await fetch(baseUrl);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /OPS CANARY/);
  assert.match(dashboard.headers.get("content-security-policy"), /default-src 'self'/);

  const favicon = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(favicon.status, 204);

  const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, continuitySince: 123 });
});
