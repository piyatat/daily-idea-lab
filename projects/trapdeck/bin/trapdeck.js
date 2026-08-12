#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";

import {
  VERSION,
  analyzeCommand,
  scanPackageScripts,
  rulesReport
} from "../src/trapdeck.js";

function usage() {
  return `trapdeck ${VERSION}

Pre-approval npm/pnpm script expander — surface bait before humans approve.

Usage:
  trapdeck expand <command> [--dir dir] [--json]
  trapdeck scan [dir] [--json]
  trapdeck rules [--json]
  trapdeck --help
  trapdeck --version

Examples:
  trapdeck expand "npm run setup" --dir ./fixtures/setup-trap
  trapdeck scan .
  trapdeck rules --json

Exit codes:
  0  No error-severity bait findings
  1  Error-severity bait findings
  2  Usage or I/O error
`;
}

function printHuman(result, mode) {
  if (mode === "rules") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const label = result.ok ? "PASS" : "FAIL";
  process.stdout.write(
    `trapdeck ${VERSION} · ${label} · errors=${result.stats.errors} warnings=${result.stats.warnings}\n`
  );

  if (result.command) {
    process.stdout.write(`command: ${result.command}\n`);
  }
  if (result.pkgPath) {
    process.stdout.write(`package: ${result.pkgPath}\n`);
  }

  if (result.chain?.length) {
    process.stdout.write("expansion:\n");
    for (const step of result.chain) {
      const indent = "  ".repeat(step.depth + 1);
      process.stdout.write(`${indent}${step.command}\n`);
    }
  }

  if (result.scripts?.length) {
    process.stdout.write(`scripts scanned: ${result.scripts.length}\n`);
    for (const script of result.scripts) {
      const badge = script.ok ? "PASS" : "FAIL";
      process.stdout.write(`  [${badge}] ${script.script}: ${script.body}\n`);
      for (const item of script.findings) {
        process.stdout.write(
          `         ${item.severity.toUpperCase()} ${item.rule}: ${item.message}\n`
        );
      }
    }
  }

  if (result.findings?.length) {
    process.stdout.write("findings:\n");
    for (const item of result.findings) {
      process.stdout.write(
        `  ${item.severity.toUpperCase().padEnd(7)} ${item.rule}  ${item.message}\n`
      );
    }
  } else if (!result.scripts?.length) {
    process.stdout.write("No bait findings.\n");
  }
}

async function readPackage(dir) {
  const pkgPath = join(dir, "package.json");
  const text = await readFile(pkgPath, "utf8");
  return { pkgPath, pkgText: text };
}

async function runExpand(args) {
  const json = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");

  let dir = process.cwd();
  const dirIdx = rest.indexOf("--dir");
  if (dirIdx !== -1) {
    dir = resolve(rest[dirIdx + 1] ?? "");
    rest.splice(dirIdx, 2);
  }

  const commandParts = [];
  for (const part of rest) {
    if (part.startsWith("-")) throw new Error(`Unknown flag: ${part}`);
    commandParts.push(part);
  }

  const command = commandParts.join(" ").trim();
  if (!command) throw new Error("expand requires a command string");

  const { pkgPath, pkgText } = await readPackage(dir);
  const result = analyzeCommand({ command, pkgText, pkgPath });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result, "expand");
  }

  process.exitCode = result.ok ? 0 : 1;
}

async function runScan(args) {
  const json = args.includes("--json");
  const positional = args.filter((a) => a !== "--json" && !a.startsWith("-"));
  if (positional.length > 1) throw new Error("Expected at most one directory");
  const dir = resolve(positional[0] ?? process.cwd());

  const { pkgPath, pkgText } = await readPackage(dir);
  const result = scanPackageScripts({ pkgText, pkgPath });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result, "scan");
  }

  process.exitCode = result.ok ? 0 : 1;
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

  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "scan";

  if (command === "rules") {
    const json = args.includes("--json");
    const unknown = args.filter((a) => a !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown flag: ${unknown[0]}`);
    const report = rulesReport();
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      printHuman(report, "rules");
    }
    return;
  }

  if (command === "expand") {
    await runExpand(args);
    return;
  }

  if (command === "scan") {
    await runScan(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
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
