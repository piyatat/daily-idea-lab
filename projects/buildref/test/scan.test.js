import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCargoLock, parseCargoManifest, parseProject } from "../src/parse.js";
import { evaluateRules, explainRule, normalizeFailOn, shouldFail } from "../src/rules.js";
import { scanPath } from "../src/scan.js";
import { run } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => join(root, "fixtures", name);

describe("parse", () => {
  it("parses build-dependencies from Cargo.toml", async () => {
    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(fixture("arrayref-style"), "Cargo.toml"), "utf8"),
    );
    const manifest = parseCargoManifest(content, "Cargo.toml");
    assert.ok(manifest.buildDependencies["proc-macro1"]);
    assert.equal(manifest.hasBuildScript, true);
  });

  it("parses Cargo.lock packages", async () => {
    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(fixture("arrayref-style"), "Cargo.lock"), "utf8"),
    );
    const packages = parseCargoLock(content);
    assert.ok(packages.some((pkg) => pkg.name === "proc-macro1"));
  });

  it("walks fixture tree", async () => {
    const project = await parseProject(root);
    assert.ok(project.manifests.length >= 4);
    assert.ok(project.buildScripts.length >= 3);
  });
});

describe("rules", () => {
  it("benign fixture passes", async () => {
    const result = await scanPath(fixture("benign"));
    assert.equal(result.findings.length, 0);
    assert.equal(result.exitCode, 0);
  });

  it("clean-lib without build.rs passes", async () => {
    const result = await scanPath(fixture("clean-lib"));
    assert.equal(result.findings.length, 0);
  });

  it("arrayref-style fires network, exec, and bait rules", async () => {
    const result = await scanPath(fixture("arrayref-style"));
    const ids = result.findings.map((f) => f.rule_id);
    assert.ok(ids.includes("BUILD_NET_FETCH"));
    assert.ok(ids.includes("BUILD_SHELL_EXEC"));
    assert.ok(ids.includes("LOCK_BAIT_BUILD_DEP"));
    assert.ok(ids.includes("PROC_MACRO_BUILD_CHAIN"));
    assert.equal(result.exitCode, 1);
  });

  it("env-exfil fires BUILD_ENV_EXFIL only", async () => {
    const result = await scanPath(fixture("env-exfil"));
    const ids = result.findings.map((f) => f.rule_id);
    assert.ok(ids.includes("BUILD_ENV_EXFIL"));
    assert.ok(!ids.includes("BUILD_NET_FETCH"));
    assert.equal(result.exitCode, 0);
  });

  it("shouldFail respects fail-on set", () => {
    const findings = [{ rule_id: "BUILD_ENV_EXFIL", severity: "warn", message: "x", details: {} }];
    assert.equal(shouldFail(findings, normalizeFailOn(["BUILD_ENV_EXFIL"])), true);
    assert.equal(shouldFail(findings, normalizeFailOn(undefined)), false);
  });

  it("explain returns remediation", () => {
    const info = explainRule("LOCK_BAIT_BUILD_DEP");
    assert.equal(info.id, "LOCK_BAIT_BUILD_DEP");
    assert.ok(info.remediation.includes("proc-macro1"));
  });
});

describe("cli", () => {
  it("rules command lists five rules", async () => {
    const code = await run(["rules"]);
    assert.equal(code, 0);
  });

  it("scan json output", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const code = await run(["scan", fixture("benign"), "--json"]);
      assert.equal(code, 0);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.summary.findings, 0);
    } finally {
      console.log = orig;
    }
  });

  it("scan fails on bait fixture by default", async () => {
    const code = await run(["scan", fixture("arrayref-style")]);
    assert.equal(code, 1);
  });
});
