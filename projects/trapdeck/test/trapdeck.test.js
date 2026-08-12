import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  analyzeCommand,
  expandScriptChain,
  parsePackageJson,
  rulesReport,
  scanPackageScripts,
  PROFILE
} from "../src/trapdeck.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bin = join(root, "bin", "trapdeck.js");
const fixture = (...parts) => join(here, "fixtures", ...parts);

function run(args, cwd = root) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8"
  });
}

async function pkgText(name) {
  return readFile(fixture(name, "package.json"), "utf8");
}

test("rules report lists profile and bait rule ids", () => {
  const report = rulesReport();
  assert.equal(report.profile, PROFILE);
  assert.ok(report.rules.some((r) => r.id === "SETUP_TRAP"));
  assert.ok(report.rules.some((r) => r.id === "REMOTE_PIPE_SHELL"));
});

test("parsePackageJson rejects invalid JSON", () => {
  const parsed = parsePackageJson("{not json", "bad/package.json");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /bad\/package.json/);
});

test("expandScriptChain follows npm run nesting", async () => {
  const text = await pkgText("setup-trap");
  const parsed = parsePackageJson(text);
  const { chain, errors } = expandScriptChain({
    command: "npm run setup",
    pkg: parsed.pkg
  });
  assert.equal(errors.length, 0);
  assert.ok(chain.some((s) => s.scriptName === "postinstall"));
  assert.ok(chain.some((s) => s.command.includes("curl")));
});

test("setup trap fixture fails with SETUP_TRAP and REMOTE_PIPE_SHELL", async () => {
  const text = await pkgText("setup-trap");
  const result = analyzeCommand({
    command: "npm run setup",
    pkgText: text,
    pkgPath: "setup-trap/package.json"
  });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map((f) => f.rule));
  assert.ok(rules.has("SETUP_TRAP"));
  assert.ok(rules.has("REMOTE_PIPE_SHELL"));
  assert.ok(rules.has("HIDDEN_NODE"));
  assert.ok(rules.has("LIFECYCLE_HOOK"));
});

test("safe fixture passes expand", async () => {
  const text = await pkgText("safe");
  const result = analyzeCommand({
    command: "npm run test",
    pkgText: text,
    pkgPath: "safe/package.json"
  });
  assert.equal(result.ok, true);
  assert.equal(result.stats.errors, 0);
});

test("lifecycle prepare chain flags LIFECYCLE_HOOK", async () => {
  const text = await pkgText("lifecycle-trap");
  const result = analyzeCommand({
    command: "npm run dev",
    pkgText: text,
    pkgPath: "lifecycle-trap/package.json"
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.rule === "LIFECYCLE_HOOK"));
});

test("secret touch fixture flags SECRET_TOUCH", async () => {
  const text = await pkgText("secret-touch");
  const result = analyzeCommand({
    command: "npm run init",
    pkgText: text,
    pkgPath: "secret-touch/package.json"
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.rule === "SECRET_TOUCH"));
  assert.ok(result.findings.some((f) => f.rule === "SETUP_TRAP"));
});

test("deep nesting triggers NESTED_RUN_DEPTH warning", async () => {
  const text = await pkgText("nested-trap");
  const result = analyzeCommand({
    command: "npm run a",
    pkgText: text,
    pkgPath: "nested-trap/package.json"
  });
  assert.ok(result.findings.some((f) => f.rule === "NESTED_RUN_DEPTH"));
});

test("npx --yes triggers NPX_REMOTE warning", async () => {
  const text = await pkgText("npx-trap");
  const result = analyzeCommand({
    command: "npm run quick",
    pkgText: text,
    pkgPath: "npx-trap/package.json"
  });
  assert.ok(result.findings.some((f) => f.rule === "NPX_REMOTE"));
});

test("scanPackageScripts aggregates script results", async () => {
  const text = await pkgText("setup-trap");
  const scan = scanPackageScripts({
    pkgText: text,
    pkgPath: "setup-trap/package.json"
  });
  assert.equal(scan.ok, false);
  assert.ok(scan.stats.scripts >= 3);
  const setup = scan.scripts.find((s) => s.script === "setup");
  assert.ok(setup);
  assert.equal(setup.ok, false);
});

test("CLI expand exits 1 on setup trap fixture", () => {
  const result = run(
    ["expand", "npm run setup", "--dir", fixture("setup-trap"), "--json"],
    root
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
});

test("CLI scan exits 0 on safe fixture", () => {
  const result = run(["scan", fixture("safe"), "--json"], root);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
});

test("CLI --version prints semver", () => {
  const result = run(["--version"], root);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^0\.1\.0$/);
});
