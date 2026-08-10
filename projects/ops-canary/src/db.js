import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertMonitorId } from "./model.js";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function openStore(filename = "./ops-canary.db") {
  const databasePath = filename === ":memory:" ? filename : resolve(filename);
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      interval_ms INTEGER NOT NULL CHECK(interval_ms > 0),
      grace_ms INTEGER NOT NULL CHECK(grace_ms >= 0),
      retention_ms INTEGER NOT NULL CHECK(retention_ms > 0),
      created_at INTEGER NOT NULL,
      last_unique_at INTEGER,
      last_unique_late INTEGER NOT NULL DEFAULT 0 CHECK(last_unique_late IN (0, 1)),
      last_unique_known INTEGER NOT NULL DEFAULT 1 CHECK(last_unique_known IN (0, 1)),
      last_observed_at INTEGER,
      last_was_duplicate INTEGER NOT NULL DEFAULT 0 CHECK(last_was_duplicate IN (0, 1)),
      event_total INTEGER NOT NULL DEFAULT 0,
      duplicate_total INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      received_at INTEGER NOT NULL,
      event_digest TEXT,
      duplicate INTEGER NOT NULL DEFAULT 0 CHECK(duplicate IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS events_monitor_received
      ON events(monitor_id, received_at);
    CREATE INDEX IF NOT EXISTS events_monitor_digest
      ON events(monitor_id, event_digest);
  `);

  const monitorColumns = new Set(
    database.prepare("PRAGMA table_info(monitors)").all().map((column) => column.name),
  );
  const monitorMigrations = [
    ["last_unique_at", "INTEGER"],
    ["last_unique_late", "INTEGER NOT NULL DEFAULT 0 CHECK(last_unique_late IN (0, 1))"],
    ["last_unique_known", "INTEGER NOT NULL DEFAULT 1 CHECK(last_unique_known IN (0, 1))"],
    ["last_observed_at", "INTEGER"],
    ["last_was_duplicate", "INTEGER NOT NULL DEFAULT 0 CHECK(last_was_duplicate IN (0, 1))"],
    ["event_total", "INTEGER NOT NULL DEFAULT 0"],
    ["duplicate_total", "INTEGER NOT NULL DEFAULT 0"],
  ];
  const needsSummaryBackfill = [
    "last_unique_at",
    "last_unique_late",
    "last_observed_at",
    "last_was_duplicate",
    "event_total",
    "duplicate_total",
  ].some((name) => !monitorColumns.has(name));
  for (const [name, definition] of monitorMigrations) {
    if (!monitorColumns.has(name)) {
      database.exec(`ALTER TABLE monitors ADD COLUMN ${name} ${definition}`);
    }
  }
  if (needsSummaryBackfill) {
    const monitors = database
      .prepare("SELECT id, created_at, interval_ms, grace_ms FROM monitors")
      .all();
    const readEvents = database.prepare(
      `SELECT received_at, duplicate FROM events
       WHERE monitor_id = ? ORDER BY received_at, id`,
    );
    const updateSummary = database.prepare(
      `UPDATE monitors
       SET last_unique_at = ?, last_unique_late = ?, last_unique_known = ?,
           last_observed_at = ?, last_was_duplicate = ?,
           event_total = ?, duplicate_total = ?
       WHERE id = ?`,
    );
    for (const monitor of monitors) {
      const events = readEvents.all(monitor.id);
      const uniqueEvents = events.filter((event) => !event.duplicate);
      const latestUnique = uniqueEvents.at(-1) ?? null;
      const previousUnique = uniqueEvents.at(-2) ?? null;
      const previousAt = previousUnique?.received_at ?? monitor.created_at;
      const latestEvent = events.at(-1) ?? null;
      const latestWasLate = Boolean(
        latestUnique &&
          latestUnique.received_at > previousAt + monitor.interval_ms + monitor.grace_ms,
      );
      const latestTimingKnown = Boolean(
        latestUnique &&
          (uniqueEvents.length > 1 ||
            latestUnique.received_at <=
              monitor.created_at + monitor.interval_ms + monitor.grace_ms),
      );
      updateSummary.run(
        latestUnique?.received_at ?? null,
        latestTimingKnown && latestWasLate ? 1 : 0,
        latestTimingKnown ? 1 : 0,
        latestEvent?.received_at ?? null,
        latestEvent?.duplicate ? 1 : 0,
        events.length,
        events.filter((event) => event.duplicate).length,
        monitor.id,
      );
    }
  }

  const secretRow = database.prepare("SELECT value FROM metadata WHERE key = 'event_secret'").get();
  if (!secretRow) {
    database
      .prepare("INSERT INTO metadata(key, value) VALUES ('event_secret', ?)")
      .run(randomBytes(32).toString("hex"));
  }

  function createMonitor({
    id,
    intervalMs,
    graceMs,
    retentionMs = Math.max(DEFAULT_RETENTION_MS, intervalMs * 2 + graceMs),
    now = Date.now(),
  }) {
    const monitorId = assertMonitorId(id);
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error("Interval must be a positive integer of milliseconds.");
    }
    if (!Number.isSafeInteger(graceMs) || graceMs < 0) {
      throw new Error("Grace must be a non-negative integer of milliseconds.");
    }
    if (!Number.isSafeInteger(retentionMs) || retentionMs < intervalMs + graceMs) {
      throw new Error("Retention must cover at least one interval plus its grace period.");
    }
    const token = randomBytes(24).toString("base64url");
    database
      .prepare(
        `INSERT INTO monitors(
          id, token_hash, interval_ms, grace_ms, retention_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(monitorId, sha256(token), intervalMs, graceMs, retentionMs, now);
    return { id: monitorId, token, intervalMs, graceMs, retentionMs, createdAt: now };
  }

  function getMonitor(id) {
    const row = database
      .prepare(
        `SELECT id, interval_ms, grace_ms, retention_ms, created_at,
                last_unique_at, last_unique_late, last_unique_known, last_observed_at,
                last_was_duplicate, event_total, duplicate_total
         FROM monitors WHERE id = ?`,
      )
      .get(id);
    return row
      ? {
          id: row.id,
          intervalMs: row.interval_ms,
          graceMs: row.grace_ms,
          retentionMs: row.retention_ms,
          createdAt: row.created_at,
          lastUniqueAt: row.last_unique_at,
          lastUniqueLate: Boolean(row.last_unique_late),
          lastUniqueKnown: Boolean(row.last_unique_known),
          lastObservedAt: row.last_observed_at,
          lastWasDuplicate: Boolean(row.last_was_duplicate),
          eventTotal: row.event_total,
          duplicateTotal: row.duplicate_total,
        }
      : null;
  }

  function listMonitors() {
    return database
      .prepare(
        `SELECT id, interval_ms, grace_ms, retention_ms, created_at,
                last_unique_at, last_unique_late, last_unique_known, last_observed_at,
                last_was_duplicate, event_total, duplicate_total
         FROM monitors ORDER BY id`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        intervalMs: row.interval_ms,
        graceMs: row.grace_ms,
        retentionMs: row.retention_ms,
        createdAt: row.created_at,
        lastUniqueAt: row.last_unique_at,
        lastUniqueLate: Boolean(row.last_unique_late),
        lastUniqueKnown: Boolean(row.last_unique_known),
        lastObservedAt: row.last_observed_at,
        lastWasDuplicate: Boolean(row.last_was_duplicate),
        eventTotal: row.event_total,
        duplicateTotal: row.duplicate_total,
      }));
  }

  function listEvents(monitorId) {
    return database
      .prepare(
        `SELECT id, received_at, event_digest, duplicate
         FROM events WHERE monitor_id = ? ORDER BY received_at, id`,
      )
      .all(monitorId)
      .map((row) => ({
        id: row.id,
        receivedAt: row.received_at,
        eventDigest: row.event_digest,
        duplicate: Boolean(row.duplicate),
      }));
  }

  function prune(now = Date.now()) {
    return database
      .prepare(
        `DELETE FROM events
         WHERE id IN (
           SELECT events.id
           FROM events
           JOIN monitors ON monitors.id = events.monitor_id
           WHERE events.received_at < ? - monitors.retention_ms
         )`,
      )
      .run(now).changes;
  }

  function authorize(id, token) {
    const auth = database.prepare("SELECT token_hash FROM monitors WHERE id = ?").get(id);
    return Boolean(auth && constantTimeEqual(auth.token_hash, sha256(String(token ?? ""))));
  }

  function recordHeartbeat({ id, token, eventId = null, now = Date.now() }) {
    if (eventId !== null && (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 512)) {
      throw new Error("Event ID must be 1-512 characters.");
    }

    const tokenHash = sha256(String(token ?? ""));
    const secret = database.prepare("SELECT value FROM metadata WHERE key = 'event_secret'").get().value;
    const eventDigest =
      eventId === null ? null : createHmac("sha256", secret).update(eventId).digest("hex");

    database.exec("BEGIN IMMEDIATE");
    try {
      const auth = database
        .prepare(
          `SELECT token_hash, retention_ms, interval_ms, grace_ms, created_at, last_unique_at
           FROM monitors WHERE id = ?`,
        )
        .get(id);
      if (!auth || !constantTimeEqual(auth.token_hash, tokenHash)) {
        database.exec("ROLLBACK");
        return null;
      }
      database
        .prepare("DELETE FROM events WHERE monitor_id = ? AND received_at < ?")
        .run(id, now - auth.retention_ms);
      const duplicate =
        eventDigest !== null &&
        Boolean(
          database
            .prepare("SELECT 1 FROM events WHERE monitor_id = ? AND event_digest = ? LIMIT 1")
            .get(id, eventDigest),
        );
      const late =
        !duplicate &&
        now > (auth.last_unique_at ?? auth.created_at) + auth.interval_ms + auth.grace_ms;
      const result = database
        .prepare(
          `INSERT INTO events(monitor_id, received_at, event_digest, duplicate)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, now, eventDigest, duplicate ? 1 : 0);
      if (duplicate) {
        database
          .prepare(
            `UPDATE monitors
             SET last_observed_at =
                   CASE WHEN last_observed_at IS NULL OR ? >= last_observed_at
                        THEN ? ELSE last_observed_at END,
                 last_was_duplicate =
                   CASE WHEN last_observed_at IS NULL OR ? >= last_observed_at
                        THEN 1 ELSE last_was_duplicate END,
                 event_total = event_total + 1, duplicate_total = duplicate_total + 1
             WHERE id = ?`,
          )
          .run(now, now, now, id);
      } else {
        database
          .prepare(
            `UPDATE monitors
             SET last_unique_at =
                   CASE WHEN last_unique_at IS NULL OR ? >= last_unique_at
                        THEN ? ELSE last_unique_at END,
                 last_unique_late =
                   CASE WHEN last_unique_at IS NULL OR ? >= last_unique_at
                        THEN ? ELSE last_unique_late END,
                 last_unique_known =
                   CASE WHEN last_unique_at IS NULL OR ? >= last_unique_at
                        THEN 1 ELSE last_unique_known END,
                 last_observed_at =
                   CASE WHEN last_observed_at IS NULL OR ? >= last_observed_at
                        THEN ? ELSE last_observed_at END,
                 last_was_duplicate =
                   CASE WHEN last_observed_at IS NULL OR ? >= last_observed_at
                        THEN 0 ELSE last_was_duplicate END,
                 event_total = event_total + 1
             WHERE id = ?`,
          )
          .run(now, now, now, late ? 1 : 0, now, now, now, now, id);
      }
      database.exec("COMMIT");
      return { id: Number(result.lastInsertRowid), receivedAt: now, duplicate };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    path: databasePath,
    createMonitor,
    getMonitor,
    listMonitors,
    listEvents,
    prune,
    authorize,
    recordHeartbeat,
    close: () => database.close(),
  };
}
