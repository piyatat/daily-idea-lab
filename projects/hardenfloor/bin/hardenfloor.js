#!/usr/bin/env node

import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { homedir } from "node:os";

import {
  VERSION,
  auditConfigs,
  rulesReport
} from "../src/hardenfloor.js";

function usage() {
  return `hardenfloor ${VERSION}

Fail-closed auditor for coding-agent permission and sandbox minimum floors.

Usage:
  hardenfloor check [dir] [--json] [--codex [path]] [--claude path] [--no-require-claude]
  hardenfloor rules [--json]
  hardenfloor --help
  hardenfloor --version

Options:
  --json               Emit machine-readable JSON on stdout
  --claude <path>      Explicit path to Claude settings.json
  --codex [path]       Also audit Codex config (default: ~/.codex/config.toml)
  --no-require-claude  Do not fail when .claude/settings.json is absent
  --require-codex      Fail when Codex config is missing (implies --codex)

Exit codes:
  0  Floor satisfied (warnings allowed)
  1  Floor failures found
  2  Usage or I/O error
`;
}

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path) {
  if (!(await exists(path))) return null;
  return readFile(path, "utf8");
}

function printHuman(result) {
  const { stats, findings, ok, profile } = result;
  process.stdout.write(
    `hardenfloor ${VERSION} · profile ${profile} · ${ok ? "PASS" : "FAIL"}\n`
  );
  process.stdout.write(
    `errors=${stats.errors} warnings=${stats.warnings} claude=${stats.claude} codex=${stats.codex}\n`
  );
  if (findings.length === 0) {
    process.stdout.write("No findings.\n");
    return;
  }
  for (const item of findings) {
    const badge = item.severity.toUpperCase().padEnd(5);
    process.stdout.write(`${badge} ${item.rule}  ${item.path}\n`);
    process.stdout.write(`       ${item.message}\n`);
    if (item.evidence !== undefined) {
      const evidence =
        typeof item.evidence === "string"
          ? item.evidence
          : JSON.stringify(item.evidence);
      process.stdout.write(`       evidence: ${evidence}\n`);
    }
  }
}

async function runCheck(args) {
  const json = args.includes("--json");
  const noRequireClaude = args.includes("--no-require-claude");
  const requireCodex = args.includes("--require-codex");

  let claudePathOverride = null;
  let codexPathOverride = null;
  let auditCodex = requireCodex;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json" || arg === "--no-require-claude" || arg === "--require-codex") {
      continue;
    }
    if (arg === "--claude") {
      claudePathOverride = args[++i];
      if (!claudePathOverride) throw new Error("--claude requires a path");
      continue;
    }
    if (arg === "--codex") {
      auditCodex = true;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        codexPathOverride = next;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error("Expected at most one directory argument");
  }

  const root = resolve(positional[0] ?? process.cwd());
  const claudePath = claudePathOverride
    ? resolve(claudePathOverride)
    : join(root, ".claude", "settings.json");
  const tasksPath = join(root, ".vscode", "tasks.json");
  const defaultCodex = join(homedir(), ".codex", "config.toml");
  const codexPath = codexPathOverride
    ? resolve(codexPathOverride)
    : join(root, ".codex", "config.toml");

  const claudeText = await readOptional(claudePath);
  const tasksText = await readOptional(tasksPath);

  let codexText = null;
  let codexUsedPath = codexPath;
  if (auditCodex) {
    codexText = await readOptional(codexPath);
    if (codexText === null && !codexPathOverride) {
      codexUsedPath = defaultCodex;
      codexText = await readOptional(defaultCodex);
    }
  }

  const result = auditConfigs({
    claudeSettingsText: claudeText,
    claudeSettingsPath: claudePath,
    vsCodeTasksText: tasksText,
    vsCodeTasksPath: tasksPath,
    codexConfigText: auditCodex ? codexText : undefined,
    codexConfigPath: auditCodex ? codexUsedPath : undefined,
    requireClaude: !noRequireClaude,
    requireCodex
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result);
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

  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "check";

  if (command === "rules") {
    const json = args.includes("--json");
    const unknown = args.filter((a) => a !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown flag: ${unknown[0]}`);
    const report = rulesReport();
    process.stdout.write(
      json ? `${JSON.stringify(report)}\n` : `${JSON.stringify(report, null, 2)}\n`
    );
    return;
  }

  if (command !== "check") {
    throw new Error(`Unknown command: ${command}`);
  }

  await runCheck(args);
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
