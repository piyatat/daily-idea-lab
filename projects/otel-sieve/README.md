# otel-sieve

`otel-sieve` is a zero-network CLI that validates, redacts, and canonicalizes
GenAI OpenTelemetry JSON before traces or logs reach an observability backend.

It fails closed: malformed OTLP values and unknown `gen_ai.*` attributes produce
a nonzero exit code and no sanitized output.

## Why

Coding agents and AI frameworks increasingly export OTLP, but prompts, model
responses, tool arguments, cookies, and credentials can travel inside those
records. The GenAI semantic conventions are also evolving, so silently accepting
unknown fields can create a false sense of safety.

`otel-sieve` provides a deliberately small, inspectable boundary:

- OTLP JSON export envelopes for traces and logs
- JSON and NDJSON input
- a versioned `genai-strict-v1` attribute profile
- deterministic redaction and normalization
- machine-readable diagnostics and stable exit codes
- no dependencies, API keys, network calls, or telemetry

## Requirements

Node.js 20 or newer.

## Usage

```bash
# Validate and write sanitized canonical JSON
node bin/otel-sieve.js sanitize traces.json > safe-traces.json

# Read NDJSON from stdin
cat traces.ndjson | node bin/otel-sieve.js sanitize - > safe-traces.json

# Validate without emitting the document
node bin/otel-sieve.js check traces.json --report

# Inspect the exact support profile
node bin/otel-sieve.js schema
```

Install locally to use the shorter command:

```bash
npm link
otel-sieve sanitize traces.json > safe-traces.json
```

## What is redacted

The sanitizer replaces values with `[REDACTED]` when attribute or nested
key/value names indicate:

- prompts, completions, messages, system instructions, or model content
- tool-call arguments or results
- secrets, passwords, authorization, cookies, API keys, or auth/access tokens

For a GenAI log record, the entire OTLP `body` is redacted. Token-count
attributes such as `gen_ai.usage.input_tokens` are retained and normalized.

## Canonical output

`otel-sieve` normalizes:

- trace and span IDs to lowercase, with strict lengths and nonzero checks
- nanosecond timestamps and integer `AnyValue` members to decimal strings
- object keys, attributes, resources, scopes, spans, events, links, and log
  records into deterministic order

Equivalent supported documents therefore produce byte-identical JSON. Running
the sanitizer on its own output is idempotent.

NDJSON input is emitted as one canonical JSON array. A single JSON document is
emitted as one canonical object.

## Failure contract

On validation failure:

- stdout is empty
- stderr contains one JSON report
- the process exits with status `1`

Unreadable files, invalid commands, and usage errors exit with status `2`.

Example:

```json
{"ok":false,"profile":"genai-strict-v1","diagnostics":[{"code":"unknown_genai_attribute","path":"$.resourceSpans[0].scopeSpans[0].spans[0].attributes[0]","message":"Attribute gen_ai.future.attribute is not in genai-strict-v1"}],"stats":{"documents":1,"genaiRecords":1,"redactions":0}}
```

## Explicit non-goals

This MVP does not claim full OTLP or GenAI semantic-convention compliance. It
does not support protobuf, gRPC, metrics, live collectors, vendor exporters,
policy languages, or high-volume streaming guarantees. Run `otel-sieve schema`
for the complete support matrix.

## Development

```bash
npm test
npm run check
```

The test suite covers JSON and NDJSON fixtures, deterministic output,
idempotence, nested redaction, malformed OTLP values, unknown GenAI fields, and
the CLI fail-closed contract.
