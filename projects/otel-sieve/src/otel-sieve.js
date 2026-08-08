const PROFILE = "genai-strict-v1";
const REDACTED = "[REDACTED]";

const GENAI_ATTRIBUTES = Object.freeze({
  "gen_ai.operation.name": ["string"],
  "gen_ai.provider.name": ["string"],
  "gen_ai.system": ["string"],
  "gen_ai.request.model": ["string"],
  "gen_ai.request.max_tokens": ["int"],
  "gen_ai.request.temperature": ["double", "int"],
  "gen_ai.request.top_p": ["double", "int"],
  "gen_ai.request.frequency_penalty": ["double", "int"],
  "gen_ai.request.presence_penalty": ["double", "int"],
  "gen_ai.request.seed": ["int"],
  "gen_ai.request.stop_sequences": ["array"],
  "gen_ai.response.model": ["string"],
  "gen_ai.response.id": ["string"],
  "gen_ai.response.finish_reasons": ["array"],
  "gen_ai.usage.input_tokens": ["int"],
  "gen_ai.usage.output_tokens": ["int"],
  "gen_ai.usage.cache_read_input_tokens": ["int"],
  "gen_ai.usage.cache_write_input_tokens": ["int"],
  "gen_ai.usage.reasoning_tokens": ["int"],
  "gen_ai.conversation.id": ["string"],
  "gen_ai.agent.id": ["string"],
  "gen_ai.agent.name": ["string"],
  "gen_ai.agent.description": ["string"],
  "gen_ai.tool.name": ["string"],
  "gen_ai.tool.description": ["string"],
  "gen_ai.tool.call.id": ["string"],
  "gen_ai.data_source.id": ["string"],
  "gen_ai.input.messages": ["any"],
  "gen_ai.output.messages": ["any"],
  "gen_ai.system_instructions": ["any"],
  "gen_ai.prompt": ["any"],
  "gen_ai.completion": ["any"],
  "gen_ai.tool.call.arguments": ["any"],
  "gen_ai.tool.call.result": ["any"]
});

const CONTENT_KEY =
  /(?:^|[._-])(prompt|completion|messages?|system[._-]?instructions?|tool(?:[._-]call)?[._-](?:arguments?|result)|input[._-]?content|output[._-]?content)(?:$|[._-])/i;
const SECRET_KEY =
  /(?:^|[._-])(secret|password|passwd|authorization|cookie|api[._-]?key|token|access[._-]?token|refresh[._-]?token|auth[._-]?token)(?:$|[._-])/i;

const ANY_VALUE_KEYS = new Set([
  "stringValue",
  "boolValue",
  "intValue",
  "doubleValue",
  "bytesValue",
  "arrayValue",
  "kvlistValue"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinPath(path, segment) {
  return typeof segment === "number" ? `${path}[${segment}]` : `${path}.${segment}`;
}

function compareCanonical(left, right) {
  const a = JSON.stringify(sortObjectKeys(left));
  const b = JSON.stringify(sortObjectKeys(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys(value[key])])
  );
}

function canonicalStringify(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

class Context {
  constructor() {
    this.diagnostics = [];
    this.redactions = 0;
    this.genaiRecords = 0;
  }

  error(code, path, message) {
    this.diagnostics.push({ code, path, message });
  }

  redact() {
    this.redactions += 1;
    return { stringValue: REDACTED };
  }

  report() {
    return [...this.diagnostics].sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message)
    );
  }
}

function parseInput(text, context) {
  const trimmed = text.trim();
  if (!trimmed) {
    context.error("empty_input", "$", "Input is empty");
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (documentError) {
    const lines = text
      .split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => line.length > 0);

    if (lines.length <= 1) {
      context.error("invalid_json", "$", documentError.message);
      return [];
    }

    const documents = [];
    for (const { line, number } of lines) {
      try {
        documents.push(JSON.parse(line));
      } catch (error) {
        context.error("invalid_ndjson", `$[line:${number}]`, error.message);
      }
    }
    return documents;
  }
}

function valueKind(value) {
  if (!isObject(value)) {
    return "invalid";
  }
  const keys = Object.keys(value).filter((key) => ANY_VALUE_KEYS.has(key));
  if (keys.length !== 1 || Object.keys(value).length !== 1) {
    return "invalid";
  }
  return keys[0].replace("Value", "").replace("kvlist", "kvlist").toLowerCase();
}

function normalizeDecimal(value, path, context, code) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      context.error(code, path, "Expected a non-negative safe integer or decimal string");
      return value;
    }
    return String(value);
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    context.error(code, path, "Expected a non-negative decimal string");
    return value;
  }
  return value.replace(/^0+(?=\d)/, "");
}

function normalizeHex(value, length, path, context) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)) {
    context.error(
      "invalid_id",
      path,
      `Expected exactly ${length} hexadecimal characters`
    );
    return value;
  }
  if (/^0+$/.test(value)) {
    context.error("invalid_id", path, "Identifier cannot be all zeroes");
  }
  return value.toLowerCase();
}

function normalizeAnyValue(value, path, context) {
  if (!isObject(value)) {
    context.error("invalid_any_value", path, "Expected an OTLP AnyValue object");
    return value;
  }

  const keys = Object.keys(value);
  const unionKeys = keys.filter((key) => ANY_VALUE_KEYS.has(key));
  if (unionKeys.length !== 1 || keys.length !== 1) {
    context.error(
      "invalid_any_value",
      path,
      "AnyValue must contain exactly one supported value field"
    );
    return walk(value, path, context);
  }

  const key = unionKeys[0];
  const memberPath = joinPath(path, key);
  const member = value[key];

  switch (key) {
    case "stringValue":
      if (typeof member !== "string") {
        context.error("invalid_any_value", memberPath, "stringValue must be a string");
      }
      return { stringValue: member };
    case "boolValue":
      if (typeof member !== "boolean") {
        context.error("invalid_any_value", memberPath, "boolValue must be a boolean");
      }
      return { boolValue: member };
    case "intValue":
      return { intValue: normalizeDecimal(member, memberPath, context, "invalid_int") };
    case "doubleValue":
      if (typeof member !== "number" || !Number.isFinite(member)) {
        context.error("invalid_any_value", memberPath, "doubleValue must be a finite number");
      }
      return { doubleValue: member };
    case "bytesValue":
      if (typeof member !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(member)) {
        context.error("invalid_any_value", memberPath, "bytesValue must be base64");
      }
      return { bytesValue: member };
    case "arrayValue": {
      if (!isObject(member) || !Array.isArray(member.values)) {
        context.error(
          "invalid_any_value",
          memberPath,
          "arrayValue must contain a values array"
        );
        return { arrayValue: member };
      }
      return {
        arrayValue: {
          values: member.values.map((item, index) =>
            normalizeAnyValue(item, joinPath(joinPath(memberPath, "values"), index), context)
          )
        }
      };
    }
    case "kvlistValue": {
      if (!isObject(member) || !Array.isArray(member.values)) {
        context.error(
          "invalid_any_value",
          memberPath,
          "kvlistValue must contain a values array"
        );
        return { kvlistValue: member };
      }
      return {
        kvlistValue: {
          values: normalizeKeyValues(
            member.values,
            joinPath(memberPath, "values"),
            context,
            false
          )
        }
      };
    }
    default:
      return value;
  }
}

function validateGenAiAttribute(key, value, path, context) {
  const accepted = GENAI_ATTRIBUTES[key];
  if (!accepted) {
    context.error(
      "unknown_genai_attribute",
      path,
      `Attribute ${key} is not in ${PROFILE}`
    );
    return;
  }

  const kind = valueKind(value);
  if (!accepted.includes("any") && !accepted.includes(kind)) {
    context.error(
      "invalid_genai_type",
      joinPath(path, "value"),
      `${key} expects ${accepted.join(" or ")}, received ${kind}`
    );
    return;
  }

  if (
    (key === "gen_ai.request.stop_sequences" ||
      key === "gen_ai.response.finish_reasons") &&
    kind === "array"
  ) {
    const values = value.arrayValue?.values;
    if (!Array.isArray(values) || values.some((item) => valueKind(item) !== "string")) {
      context.error(
        "invalid_genai_type",
        joinPath(path, "value"),
        `${key} expects an array of strings`
      );
    }
  }
}

function normalizeKeyValues(values, path, context, semanticAttributes = true) {
  if (!Array.isArray(values)) {
    context.error("invalid_attributes", path, "Expected an array of key/value entries");
    return values;
  }

  const seen = new Set();
  const normalized = values.map((entry, index) => {
    const entryPath = joinPath(path, index);
    if (!isObject(entry) || typeof entry.key !== "string" || !("value" in entry)) {
      context.error(
        "invalid_attribute",
        entryPath,
        "Expected an object with string key and AnyValue value"
      );
      return walk(entry, entryPath, context);
    }

    if (seen.has(entry.key)) {
      context.error("duplicate_attribute", joinPath(entryPath, "key"), entry.key);
    }
    seen.add(entry.key);

    if (semanticAttributes && entry.key.startsWith("gen_ai.")) {
      validateGenAiAttribute(entry.key, entry.value, entryPath, context);
    }

    const shouldRedact =
      isSecretKey(entry.key) || CONTENT_KEY.test(entry.key);
    return {
      key: entry.key,
      value: shouldRedact
        ? context.redact()
        : normalizeAnyValue(entry.value, joinPath(entryPath, "value"), context)
    };
  });

  return normalized.sort(
    (a, b) => String(a?.key).localeCompare(String(b?.key)) || compareCanonical(a, b)
  );
}

function isSecretKey(key) {
  if (key === "gen_ai.usage.input_tokens" || key === "gen_ai.usage.output_tokens") {
    return false;
  }
  return SECRET_KEY.test(key);
}

function hasGenAiAttribute(attributes) {
  return (
    Array.isArray(attributes) &&
    attributes.some((entry) => typeof entry?.key === "string" && entry.key.startsWith("gen_ai."))
  );
}

function walk(value, path, context, parentKey = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) =>
      walk(item, joinPath(path, index), context, parentKey)
    );
    if (
      [
        "resourceSpans",
        "scopeSpans",
        "spans",
        "events",
        "links",
        "resourceLogs",
        "scopeLogs",
        "logRecords"
      ].includes(parentKey)
    ) {
      normalized.sort(compareCanonical);
    }
    return normalized;
  }

  if (!isObject(value)) {
    return value;
  }

  const genaiRecord = hasGenAiAttribute(value.attributes);
  if (genaiRecord) {
    context.genaiRecords += 1;
  }

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const childPath = joinPath(path, key);
    const child = value[key];

    if (key === "attributes") {
      normalized[key] = normalizeKeyValues(child, childPath, context, true);
    } else if (key === "body") {
      normalized[key] = genaiRecord
        ? context.redact()
        : normalizeAnyValue(child, childPath, context);
    } else if (key === "traceId") {
      normalized[key] = normalizeHex(child, 32, childPath, context);
    } else if (key === "spanId" || key === "parentSpanId") {
      normalized[key] = normalizeHex(child, 16, childPath, context);
    } else if (/timeUnixNano$/i.test(key)) {
      normalized[key] = normalizeDecimal(child, childPath, context, "invalid_timestamp");
    } else if (isSecretKey(key) || CONTENT_KEY.test(key)) {
      normalized[key] = REDACTED;
      context.redactions += 1;
    } else {
      normalized[key] = walk(child, childPath, context, key);
    }
  }
  return normalized;
}

function normalizeDocument(document, path, context) {
  if (!isObject(document)) {
    context.error("invalid_envelope", path, "OTLP document must be a JSON object");
    return document;
  }

  const roots = ["resourceSpans", "resourceLogs"].filter((key) => key in document);
  if (roots.length !== 1) {
    context.error(
      "invalid_envelope",
      path,
      "Expected exactly one resourceSpans or resourceLogs export envelope"
    );
  }
  if (roots.length === 1 && !Array.isArray(document[roots[0]])) {
    context.error(
      "invalid_envelope",
      joinPath(path, roots[0]),
      `${roots[0]} must be an array`
    );
  }

  return walk(document, path, context);
}

export function processText(text) {
  const context = new Context();
  const documents = parseInput(text, context);
  const normalized = documents.map((document, index) =>
    normalizeDocument(document, documents.length === 1 ? "$" : `$[${index}]`, context)
  );
  const diagnostics = context.report();

  if (diagnostics.length > 0) {
    return {
      ok: false,
      profile: PROFILE,
      output: null,
      diagnostics,
      stats: {
        documents: documents.length,
        genaiRecords: context.genaiRecords,
        redactions: context.redactions
      }
    };
  }

  return {
    ok: true,
    profile: PROFILE,
    output: canonicalStringify(normalized.length === 1 ? normalized[0] : normalized),
    diagnostics: [],
    stats: {
      documents: normalized.length,
      genaiRecords: context.genaiRecords,
      redactions: context.redactions
    }
  };
}

export function schemaReport() {
  return {
    profile: PROFILE,
    supportedEnvelopes: ["resourceSpans", "resourceLogs"],
    supportedAttributes: Object.fromEntries(
      Object.entries(GENAI_ATTRIBUTES).sort(([a], [b]) => a.localeCompare(b))
    ),
    contentKeyPattern: CONTENT_KEY.source,
    secretKeyPattern: SECRET_KEY.source,
    redactionMarker: REDACTED,
    unsupported: [
      "protobuf",
      "gRPC",
      "metrics",
      "network collectors",
      "full OTLP compliance",
      "full GenAI semantic-convention compliance"
    ]
  };
}

export { PROFILE, REDACTED, canonicalStringify };
