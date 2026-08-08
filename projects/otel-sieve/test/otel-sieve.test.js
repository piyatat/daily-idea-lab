import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { processText, REDACTED, schemaReport } from "../src/otel-sieve.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const fixture = (name) => join(here, "fixtures", name);

async function readFixture(name) {
  return readFile(fixture(name), "utf8");
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)])
  );
}

test("sanitizes GenAI traces and emits deterministic canonical JSON", async () => {
  const input = await readFixture("valid-traces.json");
  const result = processText(input);

  assert.equal(result.ok, true);
  assert.equal(result.stats.documents, 1);
  assert.equal(result.stats.redactions, 5);
  assert.equal(result.stats.genaiRecords, 3);
  assert.ok(result.output.endsWith("\n"));
  assert.equal(result.output.includes("my private prompt"), false);
  assert.equal(result.output.includes("private model response"), false);
  assert.equal(result.output.includes("supersecret"), false);
  assert.equal(result.output.includes("secret-token"), false);

  const document = JSON.parse(result.output);
  const spans = document.resourceSpans[0].scopeSpans[0].spans;
  assert.deepEqual(
    spans.map((span) => span.spanId),
    ["1111111111111111", "bbbbbbbbbbbbbbbb"]
  );
  assert.equal(spans[0].traceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(spans[0].attributes[0].key, "gen_ai.input.messages");
  assert.deepEqual(spans[0].attributes[0].value, { stringValue: REDACTED });
  assert.equal(
    spans[0].attributes.find((item) => item.key === "gen_ai.usage.input_tokens")
      .value.intValue,
    "12"
  );
});

test("canonicalization is insensitive to object, attribute, and record order", async () => {
  const parsed = JSON.parse(await readFixture("valid-traces.json"));
  const reordered = reverseObjectKeys(parsed);
  const spans = reordered.resourceSpans[0].scopeSpans[0].spans;
  spans.reverse();
  for (const span of spans) {
    span.attributes.reverse();
  }

  const original = processText(JSON.stringify(parsed));
  const changed = processText(JSON.stringify(reordered));
  assert.equal(original.ok, true);
  assert.equal(changed.ok, true);
  assert.equal(changed.output, original.output);
});

test("sanitization is byte-for-byte idempotent", async () => {
  const first = processText(await readFixture("valid-traces.json"));
  const second = processText(first.output);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.output, first.output);
  assert.equal(second.stats.redactions, first.stats.redactions);
});

test("accepts NDJSON and redacts GenAI log bodies", async () => {
  const result = processText(await readFixture("valid-logs.ndjson"));

  assert.equal(result.ok, true);
  assert.equal(result.stats.documents, 2);
  const documents = JSON.parse(result.output);
  assert.equal(documents.length, 2);
  for (const document of documents) {
    const record = document.resourceLogs[0].scopeLogs[0].logRecords[0];
    assert.deepEqual(record.body, { stringValue: REDACTED });
  }
  assert.equal(result.output.includes("raw prompt"), false);
  assert.equal(result.output.includes("password"), false);
});

test("fails closed on unknown GenAI attributes", async () => {
  const result = processText(await readFixture("invalid-unknown.json"));

  assert.equal(result.ok, false);
  assert.equal(result.output, null);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ["unknown_genai_attribute"]
  );
  assert.match(result.diagnostics[0].path, /attributes\[0\]$/);
});

test("fails closed on malformed IDs, timestamps, and AnyValue data", () => {
  const result = processText(
    JSON.stringify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  traceId: "xyz",
                  spanId: "0000000000000000",
                  timeUnixNano: -1,
                  attributes: [
                    {
                      key: "gen_ai.operation.name",
                      value: { stringValue: "chat", intValue: "1" }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.output, null);
  assert.deepEqual(
    new Set(result.diagnostics.map(({ code }) => code)),
    new Set(["invalid_id", "invalid_timestamp", "invalid_genai_type", "invalid_any_value"])
  );
});

test("CLI writes no sanitized data when validation fails", () => {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "bin", "otel-sieve.js"), "sanitize", fixture("invalid-unknown.json")],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const report = JSON.parse(result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.profile, "genai-strict-v1");
  assert.equal(report.diagnostics[0].code, "unknown_genai_attribute");
});

test("CLI check and schema commands have stable contracts", async () => {
  const check = spawnSync(
    process.execPath,
    [
      join(projectRoot, "bin", "otel-sieve.js"),
      "check",
      fixture("valid-traces.json"),
      "--report"
    ],
    { encoding: "utf8" }
  );
  assert.equal(check.status, 0);
  assert.equal(check.stdout, "");
  assert.equal(JSON.parse(check.stderr).ok, true);

  const schema = schemaReport();
  assert.equal(schema.profile, "genai-strict-v1");
  assert.ok(schema.supportedAttributes["gen_ai.operation.name"]);
  assert.ok(schema.unsupported.includes("protobuf"));
});
