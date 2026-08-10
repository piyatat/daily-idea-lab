import { openStore } from "./db.js";
import { evaluateMonitor, formatDuration, parseDuration } from "./model.js";
import { createOpsServer, monitorSummary } from "./server.js";

const HELP = `ops-canary — payload-free automation heartbeat monitor

Usage:
  ops-canary add <id> --every <duration> [--grace <duration>] [--retention <duration>]
  ops-canary list
  ops-canary serve [--port 8787]

Command option:
  --db <path>          SQLite database (default: ./ops-canary.db)

Examples:
  ops-canary add daily-invoice-sync --every 1d --grace 15m
  ops-canary serve
  curl -X POST -H 'Authorization: Bearer <token>' -H 'X-Ops-Event-Id: run-42' <endpoint>

States describe heartbeat receipt only; they never certify workflow success.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const [rawName, inlineValue] = argument.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[rawName] = inlineValue;
    } else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${rawName}.`);
      flags[rawName] = value;
      index += 1;
    }
  }
  return { positional, flags };
}

function databasePath(flags) {
  return flags.db ?? process.env.OPS_CANARY_DB ?? "./ops-canary.db";
}

function assertOptions(flags, allowed) {
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw new Error(`Unknown option --${name}.`);
  }
}

function printMonitor(item) {
  console.log(monitorSummary(item));
  console.log(`  ${item.detail}`);
  console.log(`  last observed: ${item.lastObservedAt ? new Date(item.lastObservedAt).toISOString() : "never"}`);
  console.log(`  next deadline: ${new Date(item.deadlineAt).toISOString()}`);
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }

  const command = argv[0];
  const { positional, flags } = parseArgs(argv.slice(1));

  if (command === "add") {
    assertOptions(flags, ["db", "every", "grace", "retention"]);
    const id = positional[0];
    if (!id || positional.length !== 1 || !flags.every) {
      throw new Error("Usage: ops-canary add <id> --every <duration> [--grace <duration>]");
    }
    const intervalMs = parseDuration(flags.every);
    const graceMs = flags.grace ? parseDuration(flags.grace) : Math.max(1_000, Math.round(intervalMs / 10));
    const retentionMs = flags.retention
      ? parseDuration(flags.retention)
      : Math.max(parseDuration("7d"), intervalMs * 2 + graceMs);
    const store = openStore(databasePath(flags));
    try {
      const monitor = store.createMonitor({ id, intervalMs, graceMs, retentionMs });
      const path = `/api/heartbeat/${encodeURIComponent(monitor.id)}`;
      console.log(`Created ${monitor.id} (every ${formatDuration(intervalMs)}, grace ${formatDuration(graceMs)}).`);
      console.log("Save this token in your workflow secret store; it is shown only once:");
      console.log(`  ${monitor.token}`);
      console.log("Default local endpoint:");
      console.log(`  http://127.0.0.1:8787${path}`);
      console.log(`  Authorization: Bearer ${monitor.token}`);
      console.log("Send a stable event ID with X-Ops-Event-Id to detect duplicates.");
    } finally {
      store.close();
    }
    return 0;
  }

  if (command === "list") {
    assertOptions(flags, ["db"]);
    if (positional.length !== 0) throw new Error("Usage: ops-canary list [--db <path>]");
    const store = openStore(databasePath(flags));
    try {
      store.prune();
      const monitors = store.listMonitors();
      if (monitors.length === 0) {
        console.log("No monitors configured.");
        return 0;
      }
      for (const monitor of monitors) {
        printMonitor(evaluateMonitor(monitor, store.listEvents(monitor.id), { continuitySince: null }));
      }
      console.log("\nMissing windows are reported as unknown here; run the receiver for continuous-uptime judgments.");
    } finally {
      store.close();
    }
    return 0;
  }

  if (command === "serve") {
    assertOptions(flags, ["db", "port"]);
    if (positional.length !== 0) throw new Error("Usage: ops-canary serve [--port 8787]");
    const port = Number(flags.port ?? 8787);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error("Port must be an integer from 0 to 65535.");
    }
    const { server, continuitySince } = createOpsServer({ dbPath: databasePath(flags) });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const address = server.address();
    console.log(`Ops Canary listening on http://127.0.0.1:${address.port}`);
    console.log(`Continuous observation began ${new Date(continuitySince).toISOString()}.`);
    console.log("Receipt timing does not prove workflow correctness.");
    return new Promise((resolve) => {
      const shutdown = () => server.close(() => resolve(0));
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  }

  throw new Error(`Unknown command "${command}".\n\n${HELP}`);
}
