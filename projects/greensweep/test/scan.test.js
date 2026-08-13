import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRecords } from "../src/parse.js";
import { evaluateRules, shouldFail, normalizeFailOn } from "../src/rules.js";
import { scanFile } from "../src/scan.js";
import { run } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => join(root, "fixtures", name);

describe("parse", () => {
  it("normalizes alias fields", () => {
    const { records } = loadRecords(fixture("clean-run.jsonl"));
    assert.equal(records.length, 1);
    assert.equal(records[0].run_id, "clean-001");
    assert.equal(records[0].bytes_out, 4096);
    assert.equal(records[0].artifacts.length, 2);
    assert.equal(records[0].tool_calls, 12);
  });

  it("skips malformed lines with warnings", () => {
    const { records, warnings } = loadRecords(fixture("malformed.jsonl"));
    assert.equal(records.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /line 2/);
  });
});

describe("rules", () => {
  it("clean run has no findings", () => {
    const { records } = loadRecords(fixture("clean-run.jsonl"));
    assert.deepEqual(evaluateRules(records[0]), []);
  });

  it("zero bytes fixture fires ZERO_BYTES, NO_TOOL_CALLS, STATUS_ONLY", () => {
    const { records } = loadRecords(fixture("zero-bytes.jsonl"));
    const ids = evaluateRules(records[0]).map((f) => f.rule_id).sort();
    assert.deepEqual(ids, ["NO_TOOL_CALLS", "STATUS_ONLY", "ZERO_BYTES"]);
  });

  it("missing artifacts fixture fires MISSING_ARTIFACTS", () => {
    const { records } = loadRecords(fixture("no-artifacts.jsonl"));
    const ids = evaluateRules(records[0]).map((f) => f.rule_id);
    assert.ok(ids.includes("MISSING_ARTIFACTS"));
  });

  it("no tool calls fixture fires NO_TOOL_CALLS", () => {
    const { records } = loadRecords(fixture("no-tool-calls.jsonl"));
    const ids = evaluateRules(records[0]).map((f) => f.rule_id);
    assert.ok(ids.includes("NO_TOOL_CALLS"));
  });

  it("status-only fixture fires STATUS_ONLY", () => {
    const { records } = loadRecords(fixture("status-only-success.jsonl"));
    const ids = evaluateRules(records[0]).map((f) => f.rule_id);
    assert.ok(ids.includes("STATUS_ONLY"));
  });

  it("failed runs are ignored", () => {
    const { records } = loadRecords(fixture("failed-run.jsonl"));
    assert.deepEqual(evaluateRules(records[0]), []);
  });
});

describe("scan", () => {
  it("clean fixture exits 0", () => {
    const result = scanFile(fixture("clean-run.jsonl"));
    assert.equal(result.exitCode, 0);
    assert.equal(result.findings.length, 0);
  });

  it("zero bytes fixture exits 1", () => {
    const result = scanFile(fixture("zero-bytes.jsonl"));
    assert.equal(result.exitCode, 1);
    assert.ok(result.findings.length >= 1);
  });

  it("json output includes summary", () => {
    const result = scanFile(fixture("zero-bytes.jsonl"), { asJson: true });
    assert.equal(result.report.summary.runs_scanned, 1);
    assert.ok(result.report.summary.rules_fired >= 1);
    assert.ok(result.report.findings.length >= 1);
  });

  it("fail-on filter limits exit code", () => {
    const result = scanFile(fixture("zero-bytes.jsonl"), { failOn: ["MISSING_ARTIFACTS"] });
    assert.equal(result.exitCode, 0);
    assert.ok(result.findings.length >= 1);
  });

  it("fail-on matching rule exits 1", () => {
    const result = scanFile(fixture("zero-bytes.jsonl"), { failOn: ["ZERO_BYTES"] });
    assert.equal(result.exitCode, 1);
  });
});

describe("shouldFail", () => {
  it("returns false for empty findings", () => {
    assert.equal(shouldFail([], null), false);
  });

  it("respects fail-on set", () => {
    const findings = [{ rule_id: "ZERO_BYTES" }];
    assert.equal(shouldFail(findings, normalizeFailOn(["MISSING_ARTIFACTS"])), false);
    assert.equal(shouldFail(findings, normalizeFailOn(["ZERO_BYTES"])), true);
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
    const code = await run(["scan", fixture("clean-run.jsonl")]);
    assert.equal(code, 0);
  });
});
