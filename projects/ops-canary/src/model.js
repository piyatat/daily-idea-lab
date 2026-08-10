const DURATION_UNITS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use values such as 30s, 5m, or 1h.`);
  }

  const milliseconds = Number(match[1]) * DURATION_UNITS[match[2].toLowerCase()];
  if (!Number.isSafeInteger(Math.round(milliseconds)) || milliseconds < 1) {
    throw new Error(`Invalid duration "${value}".`);
  }
  return Math.round(milliseconds);
}

export function formatDuration(milliseconds) {
  if (milliseconds % DURATION_UNITS.d === 0) return `${milliseconds / DURATION_UNITS.d}d`;
  if (milliseconds % DURATION_UNITS.h === 0) return `${milliseconds / DURATION_UNITS.h}h`;
  if (milliseconds % DURATION_UNITS.m === 0) return `${milliseconds / DURATION_UNITS.m}m`;
  if (milliseconds % DURATION_UNITS.s === 0) return `${milliseconds / DURATION_UNITS.s}s`;
  return `${milliseconds}ms`;
}

export function assertMonitorId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/i.test(id)) {
    throw new Error("Monitor ID must be 3-64 letters, numbers, hyphens, or underscores.");
  }
  return id;
}

export function evaluateMonitor(monitor, events, options = {}) {
  const now = options.now ?? Date.now();
  const continuitySince = options.continuitySince ?? null;
  const ordered = [...events].sort((a, b) => a.receivedAt - b.receivedAt || a.id - b.id);
  const uniqueEvents = ordered.filter((event) => !event.duplicate);
  const latestUnique = uniqueEvents.at(-1) ?? null;
  const latestEvent = ordered.at(-1) ?? null;
  const lastUniqueAt = monitor.lastUniqueAt ?? latestUnique?.receivedAt ?? null;
  const lastObservedAt = monitor.lastObservedAt ?? latestEvent?.receivedAt ?? null;
  const lastWasDuplicate = monitor.lastWasDuplicate ?? latestEvent?.duplicate ?? false;
  const anchorAt = lastUniqueAt ?? monitor.createdAt;
  const dueAt = anchorAt + monitor.intervalMs;
  const deadlineAt = dueAt + monitor.graceMs;

  let state;
  let detail;

  if (now > deadlineAt) {
    if (continuitySince === null || continuitySince > anchorAt) {
      state = "unknown";
      detail = "Not enough continuous receiver uptime to judge this window.";
    } else {
      state = "missing";
      detail = "Heartbeat not observed by the deadline plus grace period.";
    }
  } else if (lastWasDuplicate && lastObservedAt >= (lastUniqueAt ?? 0)) {
    state = "duplicate";
    detail = "The latest event ID was observed more than once.";
  } else if (lastUniqueAt !== null && monitor.lastUniqueKnown === false) {
    state = "unknown";
    detail = "The retained history is insufficient to classify the latest heartbeat timing.";
  } else if (lastUniqueAt !== null) {
    const index = uniqueEvents.length - 1;
    const previousAt = index > 0 ? uniqueEvents[index - 1].receivedAt : monitor.createdAt;
    const previousDeadline = previousAt + monitor.intervalMs + monitor.graceMs;
    const latestWasLate =
      monitor.lastUniqueLate ?? (latestUnique ? latestUnique.receivedAt > previousDeadline : false);
    if (latestWasLate) {
      state = "late";
      detail = "The latest heartbeat arrived after its deadline plus grace period.";
    } else {
      state = "on-time";
      detail = "The latest heartbeat was observed within its expected window.";
    }
  } else {
    state = "unknown";
    detail = "Awaiting the first heartbeat; no receipt baseline exists yet.";
  }

  return {
    id: monitor.id,
    state,
    detail,
    intervalMs: monitor.intervalMs,
    graceMs: monitor.graceMs,
    createdAt: monitor.createdAt,
    lastObservedAt,
    lastUniqueAt,
    dueAt,
    deadlineAt,
    eventCount: monitor.eventTotal ?? ordered.length,
    duplicateCount:
      monitor.duplicateTotal ?? ordered.filter((event) => event.duplicate).length,
  };
}
