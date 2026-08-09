import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  auditConfigs,
  parseTomlLite,
  rulesReport,
  PROFILE
} from "../src/hardenfloor.js";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bin = join(root, "bin", "hardenfloor.js");
const fixture = (...parts) => join(here, "fixtures", ...parts);

function run(args, cwd = root) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8"
  });
}

test("rules report lists profile and rule ids", () => {
  const report = rulesReport();
  assert.equal(report.profile, PROFILE);
  assert.ok(report.rules.some((r) => r.id === "CLAUDE_PERMISSIVE_MODE"));
  assert.ok(report.rules.some((r) => r.id === "CLAUDE_CHAINEDROP_HOOK"));
});

test("parseTomlLite reads Codex keys", () => {
  const parsed = parseTomlLite(`
# comment
approval_policy = "never"
sandbox_mode = "danger-full-access"

[sandbox_workspace_write]
network_access = true
`);
  assert.equal(parsed.approval_policy, "never");
  assert.equal(parsed.sandbox_mode, "danger-full-access");
  assert.equal(parsed.sandbox_workspace_write.network_access, true);
});

test("safe Claude floor passes", async () => {
  const text = await readFile(fixture("safe", ".claude", "settings.json"), "utf8");
  const result = auditConfigs({
    claudeSettingsText: text,
    claudeSettingsPath: "safe/.claude/settings.json",
    requireClaude: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.stats.errors, 0);
});

test("yolo Claude floor fails with expected rules", async () => {
  const text = await readFile(
    fixture("yolo-claude", ".claude", "settings.json"),
    "utf8"
  );
  const result = auditConfigs({
    claudeSettingsText: text,
    claudeSettingsPath: "yolo/.claude/settings.json"
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map((f) => f.rule));
  assert.ok(rules.has("CLAUDE_PERMISSIVE_MODE"));
  assert.ok(rules.has("CLAUDE_SANDBOX_DISABLED"));
  assert.ok(rules.has("CLAUDE_MISSING_SECRET_DENY"));
  assert.ok(rules.has("CLAUDE_SKIP_DANGEROUS_PROMPT"));
});

test("open Codex config fails YOLO rules", async () => {
  const text = await readFile(
    fixture("open-codex", ".codex", "config.toml"),
    "utf8"
  );
  const result = auditConfigs({
    claudeSettingsText: null,
    requireClaude: false,
    codexConfigText: text,
    codexConfigPath: "open-codex/.codex/config.toml",
    requireCodex: true
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map((f) => f.rule));
  assert.ok(rules.has("CODEX_APPROVAL_NEVER"));
  assert.ok(rules.has("CODEX_SANDBOX_FULL_ACCESS"));
});

test("ChainDrop-style hooks and folderOpen tasks are flagged", async () => {
  const settings = await readFile(
    fixture("chaindrop-hooks", ".claude", "settings.json"),
    "utf8"
  );
  const tasks = await readFile(
    fixture("chaindrop-hooks", ".vscode", "tasks.json"),
    "utf8"
  );
  const result = auditConfigs({
    claudeSettingsText: settings,
    vsCodeTasksText: tasks
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map((f) => f.rule));
  assert.ok(rules.has("CLAUDE_CHAINEDROP_HOOK"));
  assert.ok(rules.has("VSCODE_CHAINEDROP_TASK"));
});

test("CLI check passes on safe fixture", () => {
  const result = run(["check", fixture("safe"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
});

test("CLI check fails on yolo fixture", () => {
  const result = run(["check", fixture("yolo-claude"), "--json"]);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.findings.some((f) => f.rule === "CLAUDE_PERMISSIVE_MODE"));
});

test("CLI detects ChainDrop fixtures", () => {
  const result = run(["check", fixture("chaindrop-hooks"), "--json"]);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  const rules = body.findings.map((f) => f.rule);
  assert.ok(rules.includes("CLAUDE_CHAINEDROP_HOOK"));
  assert.ok(rules.includes("VSCODE_CHAINEDROP_TASK"));
});

test("CLI audits Codex with --codex and --no-require-claude", () => {
  const result = run([
    "check",
    fixture("open-codex"),
    "--no-require-claude",
    "--codex",
    fixture("open-codex", ".codex", "config.toml"),
    "--json"
  ]);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.ok(body.findings.some((f) => f.rule === "CODEX_APPROVAL_NEVER"));
});

test("missing Claude settings fails closed", () => {
  const result = run(["check", fixture("open-codex"), "--json"]);
  assert.equal(result.status, 1);
  const body = JSON.parse(result.stdout);
  assert.ok(body.findings.some((f) => f.rule === "CLAUDE_SETTINGS_MISSING"));
});

test("CLI rules and version commands work", () => {
  const rules = run(["rules", "--json"]);
  assert.equal(rules.status, 0);
  assert.equal(JSON.parse(rules.stdout).profile, PROFILE);

  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^0\.1\.0\n$/);
});
