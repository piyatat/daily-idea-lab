import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { analyzeSession, shouldFail } from "../src/analyze.js";
import { loadEvents } from "../src/parse.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(rootDir, "bin/ghostroster.js");
const fixtures = path.join(rootDir, "test/fixtures");

const defaultOptions = { staleHours: 24, maxDepth: 5, pollThreshold: 5 };

function fixture(name) {
  return path.join(fixtures, name);
}

test("loadEvents parses JSONL session export", () => {
  const events = loadEvents(fixture("clean.jsonl"));
  assert.equal(events.length, 3);
  assert.equal(events[0].kind, "spawn");
  assert.equal(events[2].kind, "complete");
});

test("clean session has no findings", () => {
  const report = analyzeSession(loadEvents(fixture("clean.jsonl")), defaultOptions);
  assert.equal(report.findings.length, 0);
  assert.equal(shouldFail(report), false);
});

test("detects ghost-open completed subagent", () => {
  const report = analyzeSession(loadEvents(fixture("ghost-open.jsonl")), defaultOptions);
  assert.ok(report.findings.some((f) => f.id === "ghost-open"));
  assert.equal(shouldFail(report), true);
});

test("detects stale running subagent", () => {
  const report = analyzeSession(loadEvents(fixture("stale-running.jsonl")), {
    ...defaultOptions,
    staleHours: 6,
  });
  assert.ok(report.findings.some((f) => f.id === "stale-running"));
});

test("detects deep spawn tree", () => {
  const report = analyzeSession(loadEvents(fixture("deep-tree.jsonl")), defaultOptions);
  assert.ok(report.findings.some((f) => f.id === "deep-tree"));
  assert.ok(report.summary.maxDepth >= 7);
});

test("detects poll loop pattern", () => {
  const report = analyzeSession(loadEvents(fixture("poll-loop.jsonl")), defaultOptions);
  assert.ok(report.findings.some((f) => f.id === "poll-loop"));
});

test("detects post-done churn", () => {
  const report = analyzeSession(loadEvents(fixture("post-done-churn.jsonl")), defaultOptions);
  assert.ok(report.findings.some((f) => f.id === "post-done-churn"));
});

test("detects orphan spawn", () => {
  const report = analyzeSession(loadEvents(fixture("orphan-spawn.jsonl")), {
    ...defaultOptions,
    staleHours: 1,
  });
  assert.ok(report.findings.some((f) => f.id === "orphan-spawn"));
});

test("CLI scan exits 0 on clean fixture", () => {
  const result = spawnSync(process.execPath, [bin, "scan", fixture("clean.jsonl")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 finding/);
});

test("CLI --fail exits 1 on ghost-open fixture", () => {
  const result = spawnSync(
    process.execPath,
    [bin, "scan", fixture("ghost-open.jsonl"), "--fail"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GHOST-OPEN|ghost-open|Completed subagent/i);
});

test("CLI --json emits structured report", () => {
  const result = spawnSync(
    process.execPath,
    [bin, "scan", fixture("poll-loop.jsonl"), "--json"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, "0.1.0");
  assert.ok(Array.isArray(report.findings));
});
