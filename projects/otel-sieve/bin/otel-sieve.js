#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { processText, schemaReport } from "../src/otel-sieve.js";

const VERSION = "0.1.0";

function usage() {
  return `otel-sieve ${VERSION}

Fail-closed sanitizer and canonicalizer for GenAI OTLP JSON.

Usage:
  otel-sieve sanitize [file|-] [--report]
  otel-sieve check [file|-] [--report]
  otel-sieve schema
  otel-sieve --help

Commands:
  sanitize  Validate, redact, and write canonical JSON (default)
  check     Validate without writing the sanitized document
  schema    Print the exact genai-strict-v1 support profile

Exit codes:
  0  Valid input
  1  Validation failed
  2  Invalid command, unreadable input, or other usage error
`;
}

function writeReport(result) {
  process.stderr.write(
    `${JSON.stringify({
      ok: result.ok,
      profile: result.profile,
      diagnostics: result.diagnostics,
      stats: result.stats
    })}\n`
  );
}

async function readInput(path) {
  if (!path || path === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path, "utf8");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "sanitize";
  const report = args.includes("--report");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const unknownFlags = args.filter(
    (arg) => arg.startsWith("-") && arg !== "-" && arg !== "--report"
  );

  if (command === "schema") {
    if (positional.length > 0 || unknownFlags.length > 0) {
      throw new Error("schema does not accept a file or flags");
    }
    process.stdout.write(`${JSON.stringify(schemaReport(), null, 2)}\n`);
    return;
  }

  if (!["sanitize", "check"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown flag: ${unknownFlags[0]}`);
  }
  if (positional.length > 1) {
    throw new Error("Expected at most one input file");
  }

  const input = await readInput(positional[0]);
  const result = processText(input);
  if (!result.ok) {
    writeReport(result);
    process.exitCode = 1;
    return;
  }

  if (command === "sanitize") {
    process.stdout.write(result.output);
  }
  if (report) {
    writeReport(result);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: "usage_error",
        message: error instanceof Error ? error.message : String(error)
      }
    })}\n`
  );
  process.exitCode = 2;
});
