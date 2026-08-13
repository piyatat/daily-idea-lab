import { readFileSync } from "node:fs";

/** @typedef {object} RunRecord
 * @property {string} run_id
 * @property {string} status
 * @property {number} bytes_out
 * @property {string[]} artifacts
 * @property {number} tool_calls
 * @property {number} files_touched
 * @property {number} duration_ms
 * @property {string[]} events
 * @property {boolean} expects_artifacts
 * @property {number} line
 */

/**
 * @param {string} filePath
 * @returns {{ records: RunRecord[], warnings: string[] }}
 */
export function loadRecords(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  /** @type {RunRecord[]} */
  const records = [];
  /** @type {string[]} */
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    try {
      const obj = JSON.parse(raw);
      records.push(normalizeRecord(obj, i + 1));
    } catch {
      warnings.push(`line ${i + 1}: skipped invalid JSON`);
    }
  }

  return { records, warnings };
}

/**
 * @param {Record<string, unknown>} obj
 * @param {number} line
 * @returns {RunRecord}
 */
function normalizeRecord(obj, line) {
  const runId = pickString(obj, ["run_id", "runId", "id", "session_id", "sessionId"], `run-${line}`);
  const status = normalizeStatus(pickString(obj, ["status", "state", "outcome"], "unknown"));
  const bytesOut = pickNumber(obj, ["bytes_out", "bytesOut", "bytes_written", "output_bytes", "bytes"], 0);
  const artifacts = pickArtifacts(obj);
  const toolCalls = pickNumber(obj, ["tool_calls", "toolCalls", "steps", "actions"], 0);
  const filesTouched = pickNumber(obj, ["files_touched", "filesTouched", "files_changed", "filesChanged"], 0);
  const durationMs = pickNumber(obj, ["duration_ms", "durationMs", "duration", "elapsed_ms"], 0);
  const events = pickEvents(obj);
  const expectsArtifacts = pickBoolean(obj, ["expects_artifacts", "expectsArtifacts"], artifacts.length > 0);

  return {
    run_id: runId,
    status,
    bytes_out: bytesOut,
    artifacts,
    tool_calls: toolCalls,
    files_touched: filesTouched,
    duration_ms: durationMs,
    events,
    expects_artifacts: expectsArtifacts,
    line,
  };
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {string} fallback
 */
function pickString(obj, keys, fallback) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {number} fallback
 */
function pickNumber(obj, keys, fallback) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string[]} keys
 * @param {boolean} fallback
 */
function pickBoolean(obj, keys, fallback) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

/** @param {string} status */
function normalizeStatus(status) {
  const lower = status.toLowerCase();
  if (["success", "succeeded", "completed", "done", "ok", "passed"].includes(lower)) return "success";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(lower)) return "failed";
  if (["running", "in_progress", "pending"].includes(lower)) return "running";
  return lower;
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {string[]}
 */
function pickArtifacts(obj) {
  const raw = obj.artifacts ?? obj.outputs ?? obj.output_files ?? obj.outputFiles ?? obj.deliverables;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "path" in item && typeof item.path === "string") {
        return item.path.trim();
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {string[]}
 */
function pickEvents(obj) {
  const raw = obj.events ?? obj.log ?? obj.messages ?? obj.timeline;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const type = "type" in item && typeof item.type === "string" ? item.type : "";
        const message = "message" in item && typeof item.message === "string" ? item.message : "";
        return [type, message].filter(Boolean).join(": ");
      }
      return "";
    })
    .filter(Boolean);
}
