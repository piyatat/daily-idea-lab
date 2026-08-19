import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrBody } from "../src/parse.js";
import { evaluateRules, explainRule, normalizeFailOn, shouldFail } from "../src/rules.js";
import { lintFile, lintText } from "../src/lint.js";
import { run } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => join(root, "fixtures", name);

describe("parse", () => {
  it("extracts sections and slop hits", () => {
    const parsed = parsePrBody(`## Summary\ncomprehensive robust leverage\n## Testing\n- [x] pass`);
    assert.ok(parsed.boilerplateSections.length >= 2);
    assert.ok(parsed.slopHits.length >= 2);
    assert.equal(parsed.checkedBoxes, 1);
  });
});

describe("rules", () => {
  it("minimal human fixture passes", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("minimal-human.pr.md"), "utf8"));
    const findings = evaluateRules({ parsed: parsePrBody(text), diffLines: 12 });
    assert.equal(findings.length, 0);
  });

  it("ai slop wall fires slop and boilerplate rules", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("ai-slop-wall.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: 10 }).map((f) => f.rule_id);
    assert.ok(ids.includes("PROSE_SLOP_PACK"));
    assert.ok(ids.includes("BOILERPLATE_SECTIONS"));
    assert.ok(ids.includes("CHECKED_BOX_THEATER"));
    assert.ok(ids.includes("VACUUM_RISK_SECTION"));
  });

  it("checkbox theater fixture fires CHECKED_BOX_THEATER", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("checkbox-theater.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: undefined }).map((f) => f.rule_id);
    assert.ok(ids.includes("CHECKED_BOX_THEATER"));
  });

  it("vacuum risk fixture fires VACUUM_RISK_SECTION", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("vacuum-risk.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: undefined }).map((f) => f.rule_id);
    assert.ok(ids.includes("VACUUM_RISK_SECTION"));
  });

  it("heading stuffed fixture fires HEADING_STUFFING", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("heading-stuffed.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: undefined }).map((f) => f.rule_id);
    assert.ok(ids.includes("HEADING_STUFFING"));
  });

  it("doc ratio bloat fires DOC_TO_CODE_RATIO with diff-lines", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("doc-ratio-bloat.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: 10 }).map((f) => f.rule_id);
    assert.ok(ids.includes("DOC_TO_CODE_RATIO"));
  });

  it("clean with risks passes", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("clean-with-risks.pr.md"), "utf8"));
    const findings = evaluateRules({ parsed: parsePrBody(text), diffLines: 40 });
    assert.equal(findings.length, 0);
  });

  it("multi violation fires at least three rules", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("multi-violation.pr.md"), "utf8"));
    const findings = evaluateRules({ parsed: parsePrBody(text), diffLines: 25 });
    assert.ok(findings.length >= 3);
  });

  it("missing not tested fires when diff large", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("boilerplate-agent.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: 30 }).map((f) => f.rule_id);
    assert.ok(ids.includes("MISSING_NOT_TESTED"));
  });

  it("template trifecta fires on multi-violation", async () => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(fixture("multi-violation.pr.md"), "utf8"));
    const ids = evaluateRules({ parsed: parsePrBody(text), diffLines: 25 }).map((f) => f.rule_id);
    assert.ok(ids.includes("TEMPLATE_TRIFECTA"));
  });
});

describe("lint", () => {
  it("clean fixture exits 0", async () => {
    const result = await lintFile(fixture("clean-with-risks.pr.md"), { diffLines: 40 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.findings.length, 0);
  });

  it("vacuum risk exits 1 by default", async () => {
    const result = await lintFile(fixture("vacuum-risk.pr.md"));
    assert.equal(result.exitCode, 1);
  });

  it("json output includes summary", async () => {
    const result = await lintFile(fixture("checkbox-theater.pr.md"), { asJson: true });
    assert.ok(result.report.summary.findings >= 1);
    assert.ok(result.report.findings.length >= 1);
  });

  it("fail-on filter limits exit code", async () => {
    const result = await lintFile(fixture("checkbox-theater.pr.md"), { failOn: ["VACUUM_RISK_SECTION"] });
    assert.equal(result.exitCode, 0);
    assert.ok(result.findings.length >= 1);
  });

  it("short fix passes", async () => {
    const result = await lintFile(fixture("short-fix.pr.md"));
    assert.equal(result.exitCode, 0);
  });

  it("empty body passes", async () => {
    const result = await lintFile(fixture("edge-empty.pr.md"));
    assert.equal(result.exitCode, 0);
  });
});

describe("shouldFail", () => {
  it("defaults to error severity only", () => {
    const warnOnly = [{ rule_id: "PROSE_SLOP_PACK" }];
    assert.equal(shouldFail(warnOnly, null), false);
    const err = [{ rule_id: "VACUUM_RISK_SECTION" }];
    assert.equal(shouldFail(err, null), true);
  });

  it("respects fail-on set", () => {
    const findings = [{ rule_id: "PROSE_SLOP_PACK" }];
    assert.equal(shouldFail(findings, normalizeFailOn(["PROSE_SLOP_PACK"])), true);
  });
});

describe("cli", () => {
  it("rules command exits 0", async () => {
    assert.equal(await run(["rules"]), 0);
  });

  it("explain command exits 0", async () => {
    assert.equal(await run(["explain", "VACUUM_RISK_SECTION"]), 0);
  });

  it("unknown command throws", async () => {
    await assert.rejects(() => run(["nope"]));
  });
});

describe("explainRule", () => {
  it("returns remediation for known rule", () => {
    const info = explainRule("doc-to-code-ratio");
    assert.equal(info.id, "DOC_TO_CODE_RATIO");
    assert.match(info.remediation, /diff/i);
  });
});
