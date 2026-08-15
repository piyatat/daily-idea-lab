import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePatchYaml, readPatchFile } from "../src/parse.js";
import { evaluatePatchRules, evaluateStackRules, shouldFail } from "../src/rules.js";
import { checkDirectory, checkPatchFile } from "../src/check.js";
import { checkStack } from "../src/stack.js";
import { run } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(root, "fixtures", ...parts);

describe("parse", () => {
  it("loads insert rows from patch yaml", () => {
    const doc = readPatchFile(fixture("valid-bundle", "cordis.patch.yml"));
    assert.equal(doc.inserts.length, 1);
    assert.equal(doc.inserts[0].rows.length, 3);
    assert.equal(doc.inserts[0].rows[0].id, "timer");
  });

  it("loads override rows", () => {
    const doc = parsePatchYaml(`- id: hmr\n  disabled: true\n`);
    assert.equal(doc.overrides.length, 1);
    assert.equal(doc.overrides[0].id, "hmr");
  });
});

describe("rules", () => {
  it("duplicate id fixture fires DUPLICATE_ROW_ID", () => {
    const patch = readPatchFile(fixture("duplicate-id", "cordis.patch.yml"));
    const ids = evaluatePatchRules(patch).map((f) => f.rule_id);
    assert.ok(ids.includes("DUPLICATE_ROW_ID"));
  });

  it("unscoped name fixture fires UNSCOPED_PLUGIN_NAME", () => {
    const patch = readPatchFile(fixture("unscoped-name", "cordis.patch.yml"));
    const ids = evaluatePatchRules(patch).map((f) => f.rule_id);
    assert.ok(ids.includes("UNSCOPED_PLUGIN_NAME"));
  });

  it("stack unresolved override fires UNRESOLVED_TARGET for ghost-row only", () => {
    const layers = [
      readPatchFile(fixture("stack", "base.patch.yml")),
      readPatchFile(fixture("stack", "headless.patch.yml")),
    ];
    const unresolved = evaluateStackRules(layers).filter((f) => f.rule_id === "UNRESOLVED_TARGET");
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].details?.id, "ghost-row");
  });

  it("valid bundle has no error findings", () => {
    const patch = readPatchFile(fixture("valid-bundle", "cordis.patch.yml"));
    const errors = evaluatePatchRules(patch).filter((f) => f.severity === "error");
    assert.equal(errors.length, 0);
  });
});

describe("check", () => {
  it("valid bundle directory exits 0", () => {
    const result = checkDirectory(fixture("valid-bundle"));
    assert.equal(result.exitCode, 0);
  });

  it("broken manifest exits 1", () => {
    const result = checkDirectory(fixture("broken-manifest"));
    assert.equal(result.exitCode, 1);
    assert.ok(result.findings.some((f) => f.rule_id === "MISSING_PATCH_FILE"));
  });

  it("duplicate patch exits 1", () => {
    const result = checkPatchFile(fixture("duplicate-id", "cordis.patch.yml"));
    assert.equal(result.exitCode, 1);
  });

  it("json output includes summary", () => {
    const result = checkPatchFile(fixture("duplicate-id", "cordis.patch.yml"), { asJson: true });
    assert.ok(result.report.summary.errors >= 1);
  });
});

describe("stack", () => {
  it("valid two-layer stack resolves base overrides", () => {
    const result = checkStack([
      fixture("stack", "base.patch.yml"),
      fixture("stack", "headless.patch.yml"),
    ]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.findings.some((f) => f.rule_id === "UNRESOLVED_TARGET" && f.details?.id === "ghost-row"));
  });
});

describe("cli", () => {
  it("rules command exits 0", async () => {
    assert.equal(await run(["rules"]), 0);
  });

  it("help exits 0", async () => {
    assert.equal(await run(["--help"]), 0);
  });

  it("shouldFail respects fail-on list", () => {
    const findings = [{ rule_id: "UNSCOPED_PLUGIN_NAME", severity: "warning" }];
    assert.equal(shouldFail(findings, ["UNSCOPED_PLUGIN_NAME"]), false);
    assert.equal(shouldFail(findings, undefined), false);
  });
});
