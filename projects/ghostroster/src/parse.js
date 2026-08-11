import { readFileSync } from "node:fs";

const SPAWN_TYPES = new Set([
  "spawn",
  "subagent_spawn",
  "agent_spawn",
  "delegate",
  "subagent_start",
]);

const COMPLETE_TYPES = new Set([
  "complete",
  "task_complete",
  "subagent_complete",
  "agent_complete",
  "turn_complete",
]);

const ABORT_TYPES = new Set(["abort", "turn_aborted", "agent_abort"]);

const STATUS_TYPES = new Set(["status", "agent_status", "subagent_status"]);

/**
 * @param {string} filePath
 * @returns {import('./analyze.js').SessionEvent[]}
 */
export function loadEvents(filePath) {
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON root must be an array");
    }
    return parsed.map(normalizeEvent).filter(Boolean);
  }

  const events = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = normalizeEvent(JSON.parse(trimmed));
      if (event) events.push(event);
    } catch (error) {
      throw new Error(`line ${index + 1}: ${error.message}`);
    }
  }
  return events;
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {import('./analyze.js').SessionEvent | null}
 */
function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const type = pickString(raw, ["type", "event", "kind"]) ?? "unknown";
  const ts = pickTimestamp(raw);
  const agentId = pickString(raw, [
    "agent_id",
    "agentId",
    "subagent_id",
    "subagentId",
    "id",
  ]);
  const parentId = pickString(raw, ["parent_id", "parentId", "from_agent"]);
  const childId = pickString(raw, [
    "child_id",
    "childId",
    "to_agent",
    "subagent_id",
    "subagentId",
    "agent_id",
    "agentId",
  ]);
  const status = pickString(raw, ["status", "state"]);
  const tool = pickToolName(raw);
  const input = pickToolInput(raw);
  const task = pickString(raw, ["task", "label", "name", "description"]);

  let kind = "other";
  if (SPAWN_TYPES.has(type)) kind = "spawn";
  else if (COMPLETE_TYPES.has(type)) kind = "complete";
  else if (ABORT_TYPES.has(type)) kind = "abort";
  else if (STATUS_TYPES.has(type)) kind = "status";
  else if (type === "tool_call" || type === "tool_use" || tool) kind = "tool";

  return {
    lineType: type,
    kind,
    ts,
    agentId: agentId ?? childId ?? undefined,
    parentId: parentId ?? undefined,
    childId: childId ?? agentId ?? undefined,
    status: status?.toLowerCase(),
    tool,
    input,
    task,
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

/** @param {Record<string, unknown>} raw */
function pickTimestamp(raw) {
  const value = pickString(raw, ["ts", "timestamp", "time", "created_at"]);
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** @param {Record<string, unknown>} raw */
function pickToolName(raw) {
  return pickString(raw, ["tool", "toolName", "name"]);
}

/** @param {Record<string, unknown>} raw */
function pickToolInput(raw) {
  const direct = raw.input ?? raw.args ?? raw.command;
  if (typeof direct === "string") return direct.slice(0, 500);
  if (direct && typeof direct === "object") {
    const obj = /** @type {Record<string, unknown>} */ (direct);
    const command = obj.command ?? obj.query ?? obj.path;
    if (typeof command === "string") return command.slice(0, 500);
    return JSON.stringify(direct).slice(0, 500);
  }
  return undefined;
}
