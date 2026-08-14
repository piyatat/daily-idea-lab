import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadToolCalls } from "../src/parse.js";
import { evaluateRules, shouldFail, normalizeFailOn } from "../src/rules.js";
import { scanFile } from "../src/scan.js";
import { run } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => join(root, "fixtures", name);

describe("parse", () => {
  it("loads tool calls from jsonl", () => {
    const { calls } = loadToolCalls(fixture("sequential-reads.jsonl"));
    assert.equal(calls.length, 4);
    assert.equal(calls[0].tool, "Read");
    assert.equal(calls[2].readOnly, true);
    assert.equal(calls[3].readOnly, false);
  });

  it("skips malformed lines with warnings", () => {
    const { calls, warnings } = loadToolCalls(fixture("malformed.jsonl"));
    assert.equal(calls.length, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /line 2/);
  });

  it("fingerprints identical args", () => {
    const { calls } = loadToolCalls(fixture("duplicate-rg.jsonl"));
    assert.equal(calls[0].fingerprint, calls[1].fingerprint);
  });
});

describe("rules", () => {
  it("sequential reads fixture fires PARALLEL_GROUP", () => {
    const { calls } = loadToolCalls(fixture("sequential-reads.jsonl"));
    const ids = evaluateRules(calls).map((f) => f.rule_id);
    assert.ok(ids.includes("PARALLEL_GROUP"));
    const parallel = evaluateRules(calls).find((f) => f.rule_id === "PARALLEL_GROUP");
    assert.equal(parallel?.details.saved_round_trips, 2);
  });

  it("duplicate rg fixture fires DUPLICATE_CALL", () => {
    const { calls } = loadToolCalls(fixture("duplicate-rg.jsonl"));
    const ids = evaluateRules(calls).map((f) => f.rule_id);
    assert.ok(ids.includes("DUPLICATE_CALL"));
  });

  it("edit fail loop fixture fires STUCK_LOOP", () => {
    const { calls } = loadToolCalls(fixture("edit-fail-loop.jsonl"));
    const ids = evaluateRules(calls).map((f) => f.rule_id);
    assert.ok(ids.includes("STUCK_LOOP"));
  });

  it("clean trace has no findings", () => {
    const { calls } = loadToolCalls(fixture("clean-trace.jsonl"));
    assert.deepEqual(evaluateRules(calls), []);
  });
});

describe("scan", () => {
  it("clean fixture exits 0", () => {
    const result = scanFile(fixture("clean-trace.jsonl"));
    assert.equal(result.exitCode, 0);
    assert.equal(result.findings.length, 0);
  });

  it("sequential reads fixture exits 1", () => {
    const result = scanFile(fixture("sequential-reads.jsonl"));
    assert.equal(result.exitCode, 1);
    assert.ok(result.findings.length >= 1);
  });

  it("json output includes summary", () => {
    const result = scanFile(fixture("sequential-reads.jsonl"), { asJson: true });
    assert.equal(result.report.summary.tool_calls, 4);
    assert.ok(result.report.summary.saved_round_trips >= 2);
    assert.ok(result.report.findings.length >= 1);
  });

  it("fail-on filter limits exit code", () => {
    const result = scanFile(fixture("sequential-reads.jsonl"), { failOn: ["STUCK_LOOP"] });
    assert.equal(result.exitCode, 0);
    assert.ok(result.findings.length >= 1);
  });

  it("fail-on matching rule exits 1", () => {
    const result = scanFile(fixture("edit-fail-loop.jsonl"), { failOn: ["STUCK_LOOP"] });
    assert.equal(result.exitCode, 1);
  });
});

describe("shouldFail", () => {
  it("returns false for empty findings", () => {
    assert.equal(shouldFail([], null), false);
  });

  it("respects fail-on set", () => {
    const findings = [{ rule_id: "STUCK_LOOP" }];
    assert.equal(shouldFail(findings, normalizeFailOn(["PARALLEL_GROUP"])), false);
    assert.equal(shouldFail(findings, normalizeFailOn(["STUCK_LOOP"])), true);
  });
});

describe("cli", () => {
  it("prints help", async () => {
    const code = await run(["--help"]);
    assert.equal(code, 0);
  });

  it("lists rules", async () => {
    const code = await run(["rules"]);
    assert.equal(code, 0);
  });

  it("scan command works on fixture", async () => {
    const code = await run(["scan", fixture("clean-trace.jsonl")]);
    assert.equal(code, 0);
  });
});
