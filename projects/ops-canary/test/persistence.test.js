import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openStore } from "../src/db.js";
import { evaluateMonitor } from "../src/model.js";

test("persists receipts across reopen and prunes inactive monitors on status reads", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ops-canary-"));
  const path = join(directory, "canary.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const createdAt = 1_000_000;
  let store = openStore(path);
  const monitor = store.createMonitor({
    id: "persistent-sync",
    intervalMs: 10_000,
    graceMs: 1_000,
    retentionMs: 20_000,
    now: createdAt,
  });
  store.recordHeartbeat({
    id: monitor.id,
    token: monitor.token,
    eventId: "run-one",
    now: createdAt + 5_000,
  });
  store.close();

  store = openStore(path);
  assert.equal(store.listEvents(monitor.id).length, 1);
  const now = createdAt + 25_001;
  assert.equal(store.prune(now), 1);
  assert.equal(store.listEvents(monitor.id).length, 0);
  const status = evaluateMonitor(store.getMonitor(monitor.id), [], {
    now,
    continuitySince: createdAt + 5_000,
  });
  assert.equal(status.state, "missing");
  assert.equal(status.lastUniqueAt, createdAt + 5_000);
  store.close();
});

test("retains latest cadence classification after its predecessor expires", () => {
  const store = openStore(":memory:");
  const monitor = store.createMonitor({
    id: "short-retention",
    intervalMs: 10_000,
    graceMs: 1_000,
    retentionMs: 11_000,
    now: 1_000_000,
  });
  store.recordHeartbeat({
    id: monitor.id,
    token: monitor.token,
    eventId: "run-one",
    now: 1_005_000,
  });
  store.recordHeartbeat({
    id: monitor.id,
    token: monitor.token,
    eventId: "run-two",
    now: 1_015_000,
  });

  store.prune(1_026_000);
  const status = evaluateMonitor(store.getMonitor(monitor.id), store.listEvents(monitor.id), {
    now: 1_026_000,
    continuitySince: 1_000_000,
  });
  assert.equal(status.state, "on-time");
  assert.equal(status.lastUniqueAt, 1_015_000);
  store.close();
});

test("rejects retention that cannot preserve one cadence anchor", () => {
  const store = openStore(":memory:");
  assert.throws(
    () =>
      store.createMonitor({
        id: "too-short",
        intervalMs: 10_000,
        graceMs: 1_000,
        retentionMs: 10_999,
      }),
    /Retention must cover/,
  );
  store.close();
});

test("upgrades a pre-summary database and backfills receipt state", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ops-canary-legacy-"));
  const path = join(directory, "canary.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO metadata VALUES ('event_secret', 'legacy-secret');
    CREATE TABLE monitors (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      grace_ms INTEGER NOT NULL,
      retention_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      event_digest TEXT,
      duplicate INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO monitors VALUES ('legacy-sync', 'unused', 10000, 1000, 20000, 1000000);
    INSERT INTO events(monitor_id, received_at, event_digest, duplicate)
      VALUES ('legacy-sync', 1050000, 'digest-one', 0);
  `);
  legacy.close();

  const store = openStore(path);
  const monitor = store.getMonitor("legacy-sync");
  assert.equal(monitor.lastUniqueAt, 1_050_000);
  assert.equal(monitor.lastObservedAt, 1_050_000);
  assert.equal(monitor.eventTotal, 1);
  assert.equal(monitor.lastUniqueLate, false);
  assert.equal(monitor.lastUniqueKnown, false);
  const status = evaluateMonitor(monitor, store.listEvents(monitor.id), {
    now: 1_050_500,
    continuitySince: 1_050_000,
  });
  assert.equal(status.state, "unknown");
  store.close();
});

test("out-of-order commits cannot regress the latest receipt summary", () => {
  const store = openStore(":memory:");
  const monitor = store.createMonitor({
    id: "ordered-summary",
    intervalMs: 10_000,
    graceMs: 1_000,
    now: 1_000_000,
  });
  store.recordHeartbeat({
    id: monitor.id,
    token: monitor.token,
    eventId: "newer",
    now: 1_020_000,
  });
  store.recordHeartbeat({
    id: monitor.id,
    token: monitor.token,
    eventId: "older",
    now: 1_005_000,
  });

  const persisted = store.getMonitor(monitor.id);
  assert.equal(persisted.lastUniqueAt, 1_020_000);
  assert.equal(persisted.lastObservedAt, 1_020_000);
  assert.equal(persisted.lastUniqueLate, true);
  store.close();
});
