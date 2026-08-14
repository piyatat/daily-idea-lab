import { readFileSync } from "node:fs";

/** @typedef {Object} ToolCall
 * @property {number} index
 * @property {number} line
 * @property {string} tool
 * @property {string} fingerprint
 * @property {number|undefined} turnId
 * @property {number|undefined} ts
 * @property {string[]} readPaths
 * @property {string[]} writePaths
 * @property {boolean} readOnly
 * @property {Record<string, unknown>} raw
 */

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "glob_file_search",
  "list_dir",
  "listmcpresources",
  "fetch_mcp_resource",
  "webfetch",
  "web_search",
  "task",
]);

const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "strreplace",
  "delete",
  "apply_patch",
  "notebookedit",
]);

/**
 * @param {string} filePath
 * @returns {{ calls: ToolCall[], warnings: string[] }}
 */
export function loadToolCalls(filePath) {
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return { calls: [], warnings: [] };
  }

  /** @type {ToolCall[]} */
  const calls = [];
  /** @type {string[]} */
  const warnings = [];
  let index = 0;

  if (raw.trimStart().startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON root must be an array");
    }
    for (const [line, item] of parsed.entries()) {
      pushCallsFromRecord(item, line + 1, index, calls);
      index = calls.length;
    }
    return { calls, warnings };
  }

  for (const [lineNumber, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      const before = calls.length;
      pushCallsFromRecord(record, lineNumber + 1, index, calls);
      index = calls.length;
      if (calls.length === before) {
        // line parsed but had no tool calls — fine
      }
    } catch (error) {
      warnings.push(`line ${lineNumber + 1}: ${/** @type {Error} */ (error).message}`);
    }
  }

  return { calls, warnings };
}

/**
 * @param {unknown} record
 * @param {number} line
 * @param {number} startIndex
 * @param {ToolCall[]} calls
 */
function pushCallsFromRecord(record, line, startIndex, calls) {
  if (!record || typeof record !== "object") return;
  const obj = /** @type {Record<string, unknown>} */ (record);

  const nested = extractNestedToolCalls(obj);
  if (nested.length > 0) {
    for (const [offset, nestedCall] of nested.entries()) {
      const normalized = normalizeToolCall(nestedCall, line, startIndex + offset);
      if (normalized) calls.push(normalized);
    }
    return;
  }

  const normalized = normalizeToolCall(obj, line, startIndex);
  if (normalized) calls.push(normalized);
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>[]}
 */
function extractNestedToolCalls(obj) {
  const buckets = [
    obj.tool_calls,
    obj.toolCalls,
    obj.tools,
    obj.actions,
  ];

  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (item && typeof item === "object") {
        out.push(/** @type {Record<string, unknown>} */ (item));
      }
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {number} line
 * @param {number} index
 * @returns {ToolCall | null}
 */
function normalizeToolCall(raw, line, index) {
  const type = pickString(raw, ["type", "event", "kind"])?.toLowerCase();
  const tool = pickToolName(raw);
  if (!tool) return null;

  const isExplicitToolEvent =
    type === "tool_call" ||
    type === "tool_use" ||
    type === "tool" ||
    type === "function_call" ||
    raw.tool_calls == null;

  if (!isExplicitToolEvent && type && !["assistant", "agent", "message"].includes(type)) {
    return null;
  }

  const args = pickArgs(raw);
  const fingerprint = fingerprintArgs(tool, args);
  const turnId = pickNumber(raw, ["turn_id", "turnId", "turn", "step"]);
  const ts = pickTimestamp(raw);
  const paths = extractPaths(tool, args);
  const readOnly = classifyReadOnly(tool, args, paths);

  return {
    index,
    line,
    tool,
    fingerprint,
    turnId,
    ts,
    readPaths: paths.read,
    writePaths: paths.write,
    readOnly,
    raw,
  };
}

/** @param {Record<string, unknown>} raw @param {string[]} keys */
function pickString(raw, keys) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** @param {Record<string, unknown>} raw @param {string[]} keys */
function pickNumber(raw, keys) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

/** @param {Record<string, unknown>} raw */
function pickTimestamp(raw) {
  const value = pickString(raw, ["ts", "timestamp", "time", "created_at", "started_at"]);
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** @param {Record<string, unknown>} raw */
function pickToolName(raw) {
  const direct = pickString(raw, ["tool", "toolName", "tool_name", "name"]);
  if (direct) return direct;

  const fn = raw.function;
  if (fn && typeof fn === "object") {
    const name = pickString(/** @type {Record<string, unknown>} */ (fn), ["name"]);
    if (name) return name;
  }

  return undefined;
}

/** @param {Record<string, unknown>} raw */
function pickArgs(raw) {
  const candidates = [
    raw.args,
    raw.arguments,
    raw.input,
    raw.parameters,
    raw.params,
  ];

  if (raw.function && typeof raw.function === "object") {
    const fn = /** @type {Record<string, unknown>} */ (raw.function);
    candidates.push(fn.arguments, fn.args);
  }

  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return /** @type {Record<string, unknown>} */ (parsed);
      } catch {
        return { command: candidate };
      }
    }
    if (typeof candidate === "object") {
      return /** @type {Record<string, unknown>} */ (candidate);
    }
  }

  return {};
}

/**
 * @param {string} tool
 * @param {Record<string, unknown>} args
 */
function fingerprintArgs(tool, args) {
  const stable = stableStringify(args);
  return `${tool.toLowerCase()}::${stable}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

/**
 * @param {string} tool
 * @param {Record<string, unknown>} args
 */
function extractPaths(tool, args) {
  /** @type {string[]} */
  const read = [];
  /** @type {string[]} */
  const write = [];

  const pathKeys = ["path", "file", "file_path", "target", "target_file", "notebook_path"];
  for (const key of pathKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      if (WRITE_TOOLS.has(tool.toLowerCase())) write.push(value.trim());
      else read.push(value.trim());
    }
  }

  const pattern = args.pattern ?? args.query ?? args.glob_pattern;
  if (typeof pattern === "string" && pattern.trim()) {
    read.push(`pattern:${pattern.trim()}`);
  }

  const command = args.command;
  if (typeof command === "string" && command.trim()) {
    const cmd = command.trim();
    if (WRITE_TOOLS.has(tool.toLowerCase())) write.push(`cmd:${cmd.slice(0, 200)}`);
    else read.push(`cmd:${cmd.slice(0, 200)}`);
  }

  return { read, write };
}

/**
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {{ read: string[], write: string[] }} paths
 */
function classifyReadOnly(tool, args, paths) {
  const lower = tool.toLowerCase();
  if (WRITE_TOOLS.has(lower)) return false;
  if (READ_ONLY_TOOLS.has(lower)) return true;

  if (lower === "shell" || lower === "bash") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (!command) return false;
    return isReadOnlyShell(command);
  }

  if (paths.write.length > 0) return false;
  if (paths.read.length > 0) return true;
  return false;
}

/** @param {string} command */
function isReadOnlyShell(command) {
  const destructive =
    /\b(rm|mv|cp|chmod|chown|curl\s+-X\s+POST|wget\s+-O|npm\s+install|pnpm\s+add|git\s+(commit|push|reset|checkout|merge|rebase))\b/i;
  if (destructive.test(command)) return false;

  const readOnly =
    /^(cat|head|tail|ls|find|grep|rg|wc|echo|pwd|which|node\s+--check|npm\s+test|git\s+(status|diff|log|show|branch))\b/i;
  return readOnly.test(command);
}

export { stableStringify, fingerprintArgs };
