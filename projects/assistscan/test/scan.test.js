import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "../src/cli.js";
import { scanPath, scanDirectory } from "../src/scan.js";
import {
  RULES,
  SHUTDOWN_DATE,
  daysUntilShutdown,
  explainRule,
  normalizeFailOn,
  scanLine,
  scanText,
  shouldFail,
} from "../src/rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRepo = join(root, "fixtures", "sample-repo");

describe("rules", () => {
  it("detects beta.assistants on a line", () => {
    const matches = scanLine("app.ts", 4, "  await client.beta.assistants.create({");
    assert.ok(matches.some((m) => m.rule_id === "BETA_ASSISTANTS"));
  });

  it("detects /v1/threads URL", () => {
    const matches = scanLine("legacy.py", 2, '  "https://api.openai.com/v1/threads",');
    assert.ok(matches.some((m) => m.rule_id === "V1_THREADS_URL"));
  });

  it("detects threads.runs polling", () => {
    const matches = scanLine("bot.ts", 10, "  const run = await client.beta.threads.runs.create(thread.id, {");
    assert.ok(matches.some((m) => m.rule_id === "THREADS_RUNS"));
  });

  it("clean responses sample has no matches", () => {
    const sample = `import OpenAI from "openai";\nconst c = new OpenAI();\nc.responses.create({ model: "gpt-4.1", input: "hi" });`;
    assert.equal(scanText(sample, "clean.ts").length, 0);
  });

  it("explain returns remediation", () => {
    const info = explainRule("BETA_THREADS");
    assert.equal(info.id, "BETA_THREADS");
    assert.match(info.remediation, /Conversations/);
  });

  it("normalizeFailOn defaults to error severities", () => {
    const ids = normalizeFailOn(undefined);
    assert.ok(ids.includes("BETA_ASSISTANTS"));
    assert.ok(!ids.includes("THREAD_ID_REF"));
  });

  it("shouldFail respects fail-on set", () => {
    const matches = scanText('const x = "thread_id";', "cfg.ts");
    assert.equal(shouldFail(matches, ["THREAD_ID_REF"]), true);
    assert.equal(shouldFail(matches, ["BETA_THREADS"]), false);
  });

  it("daysUntilShutdown is non-negative before shutdown", () => {
    assert.ok(daysUntilShutdown(new Date("2026-08-20T12:00:00Z")) >= 0);
    assert.equal(SHUTDOWN_DATE.toISOString().slice(0, 10), "2026-08-26");
  });
});

describe("scan fixtures", () => {
  it("clean fixture directory passes", async () => {
    const { matches } = await scanDirectory(join(fixtureRepo, "clean"));
    assert.equal(matches.length, 0);
  });

  it("violations fixture finds multiple error rules", async () => {
    const { matches } = await scanDirectory(join(fixtureRepo, "violations"));
    const ids = new Set(matches.map((m) => m.rule_id));
    assert.ok(ids.has("BETA_ASSISTANTS"));
    assert.ok(ids.has("BETA_THREADS"));
    assert.ok(ids.has("V1_THREADS_URL"));
    assert.ok(ids.has("V1_ASSISTANTS_URL"));
    assert.ok(ids.has("THREADS_RUNS"));
    assert.ok(ids.has("ASSISTANT_ID_REF"));
    assert.ok(ids.has("THREAD_ID_REF"));
    assert.ok(ids.has("AZURE_ASSISTANTS"));
  });

  it("full sample repo scan fails by default", async () => {
    const result = await scanPath(fixtureRepo);
    assert.equal(result.exitCode, 1);
    assert.ok(result.matches.length >= 8);
    assert.match(result.banner, /shutdown in \d+ day/);
  });

  it("json report includes shutdown metadata", async () => {
    const result = await scanPath(fixtureRepo, { asJson: true });
    assert.equal(result.report.tool, "assistscan");
    assert.equal(result.report.shutdown_date, "2026-08-26");
    assert.ok(result.report.match_count > 0);
  });
});

describe("cli", () => {
  it("rules lists all rules", async () => {
    const code = await run(["rules"]);
    assert.equal(code, 0);
  });

  it("scan clean path exits 0", async () => {
    const code = await run(["scan", join(fixtureRepo, "clean")]);
    assert.equal(code, 0);
  });

  it("scan violations exits 1", async () => {
    const code = await run(["scan", join(fixtureRepo, "violations")]);
    assert.equal(code, 1);
  });

  it("deadline command prints remaining days", async () => {
    const code = await run(["deadline"]);
    assert.ok(code === 0 || code === 1);
  });

  it("unknown command throws via bin wrapper", async () => {
    await assert.rejects(() => run(["nope"]), /unknown command/);
  });

  it("rule count stays stable", () => {
    assert.equal(RULES.length, 10);
  });
});
