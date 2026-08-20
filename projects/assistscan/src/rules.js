/** @typedef {Object} Rule
 * @property {string} id
 * @property {"error"|"warn"|"info"} severity
 * @property {string} message
 * @property {RegExp} pattern
 * @property {string} remediation
 */

/** OpenAI Assistants API permanent shutdown (UTC). */
export const SHUTDOWN_DATE = new Date("2026-08-26T00:00:00.000Z");

/** @type {Rule[]} */
export const RULES = [
  {
    id: "BETA_ASSISTANTS",
    severity: "error",
    message: "OpenAI SDK beta.assistants call site (removed Aug 26, 2026)",
    pattern: /\bbeta\.assistants\b/,
    remediation:
      "Replace Assistant objects with Prompts (dashboard) or inline instructions/tools on responses.create.",
  },
  {
    id: "BETA_THREADS",
    severity: "error",
    message: "OpenAI SDK beta.threads call site (removed Aug 26, 2026)",
    pattern: /\bbeta\.threads\b/,
    remediation:
      "Replace Threads with Conversations API or client-managed state via previous_response_id.",
  },
  {
    id: "V1_ASSISTANTS_URL",
    severity: "error",
    message: "Raw HTTP /v1/assistants endpoint (removed Aug 26, 2026)",
    pattern: /\/v1\/assistants\b/,
    remediation: "Migrate to Responses API; configure model/tools/instructions per request or via Prompts.",
  },
  {
    id: "V1_THREADS_URL",
    severity: "error",
    message: "Raw HTTP /v1/threads endpoint (removed Aug 26, 2026)",
    pattern: /\/v1\/threads\b/,
    remediation: "Use Conversations API for server-side state or previous_response_id for continuity.",
  },
  {
    id: "THREADS_RUNS",
    severity: "error",
    message: "Assistants run/polling loop (threads.runs or /threads/.../runs)",
    pattern: /(?:beta\.threads\.runs|\/v1\/threads\/[^"'`\s]+\/runs|threads\.runs\.create)/,
    remediation:
      "Replace async run/poll loops with synchronous responses.create and explicit tool-call handling.",
  },
  {
    id: "ASSISTANTS_RUN",
    severity: "error",
    message: "Assistants run creation (assistants.runs or threads.createAndRun)",
    pattern: /(?:beta\.threads\.createAndRun|assistants\.runs|threads\.createAndRun)/,
    remediation: "Use responses.create with input items; manage tool loops explicitly in application code.",
  },
  {
    id: "AZURE_ASSISTANTS",
    severity: "error",
    message: "Azure OpenAI Assistants client or endpoint reference",
    pattern: /(?:AzureOpenAI.*Assistants|azure\.openai\.com.*assistants|openai\.azure\.com.*assistants)/i,
    remediation: "Migrate to Microsoft Foundry Agents per Azure retirement guide (same Aug 26, 2026 date).",
  },
  {
    id: "ASSISTANT_ID_REF",
    severity: "warn",
    message: "assistant_id stored reference (Assistants object pointer)",
    pattern: /\bassistant[_-]?id\b/i,
    remediation: "Audit config/env for Assistant IDs; map to Prompt IDs or inline request configuration.",
  },
  {
    id: "THREAD_ID_REF",
    severity: "warn",
    message: "thread_id stored reference (no automated Thread→Conversation migration)",
    pattern: /\bthread[_-]?id\b/i,
    remediation:
      "Plan manual backfill: replay essential history into Conversations or drop stale thread_id pointers.",
  },
  {
    id: "OPENAI_ASSISTANT_IMPORT",
    severity: "warn",
    message: "Import or type hint referencing Assistants API surface",
    pattern: /\b(?:AssistantCreateParams|ThreadCreateParams|RunCreateParams|AssistantStreamEvent)\b/,
    remediation: "Update SDK types and imports to Responses/Conversations equivalents.",
  },
];

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

/** @typedef {Object} Match
 * @property {string} rule_id
 * @property {string} severity
 * @property {string} message
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string} snippet
 * @property {Record<string, unknown>} details
 */

/**
 * @param {string} ruleId
 * @param {string} file
 * @param {number} line
 * @param {number} column
 * @param {string} snippet
 * @param {string} [detailMessage]
 * @returns {Match}
 */
function makeMatch(ruleId, file, line, column, snippet, detailMessage) {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) {
    throw new Error(`unknown rule: ${ruleId}`);
  }
  return {
    rule_id: ruleId,
    severity: rule.severity,
    message: detailMessage ?? rule.message,
    file,
    line,
    column,
    snippet: snippet.trim(),
    details: { remediation: rule.remediation },
  };
}

/**
 * Scan one line against all rules.
 * @param {string} file
 * @param {number} lineNo
 * @param {string} line
 * @returns {Match[]}
 */
export function scanLine(file, lineNo, line) {
  /** @type {Match[]} */
  const matches = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(line);
    if (match) {
      matches.push(makeMatch(rule.id, file, lineNo, (match.index ?? 0) + 1, line));
    }
  }
  return matches;
}

/**
 * @param {string} text
 * @param {string} file
 * @returns {Match[]}
 */
export function scanText(text, file = "<stdin>") {
  /** @type {Match[]} */
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    matches.push(...scanLine(file, i + 1, lines[i]));
  }
  return matches;
}

/**
 * @param {Date} [now]
 */
export function daysUntilShutdown(now = new Date()) {
  const ms = SHUTDOWN_DATE.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * @param {string[]|undefined} failOn
 */
export function normalizeFailOn(failOn) {
  if (failOn && failOn.length > 0) {
    return failOn;
  }
  return RULES.filter((rule) => rule.severity === "error").map((rule) => rule.id);
}

/**
 * @param {Match[]} matches
 * @param {string[]} failOn
 */
export function shouldFail(matches, failOn) {
  const failSet = new Set(failOn);
  return matches.some((match) => failSet.has(match.rule_id));
}

/**
 * @param {Match[]} matches
 */
export function formatMatches(matches) {
  if (matches.length === 0) {
    return "No Assistants API call sites found.";
  }
  return matches
    .map(
      (match) =>
        `${match.file}:${match.line}:${match.column} [${match.severity}] ${match.rule_id} — ${match.message}\n  ${match.snippet}`,
    )
    .join("\n\n");
}

/**
 * @param {Match[]} matches
 * @param {{ scanned_files: number, scanned_lines: number, days_until_shutdown: number }} stats
 */
export function formatJsonReport(matches, stats) {
  return {
    tool: "assistscan",
    version: "0.1.0",
    shutdown_date: SHUTDOWN_DATE.toISOString().slice(0, 10),
    days_until_shutdown: stats.days_until_shutdown,
    scanned_files: stats.scanned_files,
    scanned_lines: stats.scanned_lines,
    match_count: matches.length,
    error_count: matches.filter((m) => m.severity === "error").length,
    warn_count: matches.filter((m) => m.severity === "warn").length,
    matches,
  };
}

/**
 * @param {string} ruleId
 */
export function explainRule(ruleId) {
  const rule = RULE_BY_ID.get(ruleId.toUpperCase());
  if (!rule) {
    throw new Error(`unknown rule id: ${ruleId}`);
  }
  return rule;
}
