/** @typedef {import("./parse.js").ToolCall} ToolCall */

/** @typedef {Object} Finding
 * @property {string} rule_id
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

export const RULES = [
  {
    id: "PARALLEL_GROUP",
    severity: "medium",
    message: "Sequential read-only tool calls that could run in parallel",
  },
  {
    id: "DUPLICATE_CALL",
    severity: "high",
    message: "Identical tool call repeated in the same session",
  },
  {
    id: "STUCK_LOOP",
    severity: "critical",
    message: "Same tool+args invoked three or more times (retry loop)",
  },
];

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

/**
 * @param {ToolCall[]} calls
 * @returns {Finding[]}
 */
export function evaluateRules(calls) {
  /** @type {Finding[]} */
  const findings = [];
  findings.push(...findParallelGroups(calls));
  findings.push(...findDuplicates(calls));
  findings.push(...findStuckLoops(calls));
  return findings;
}

/**
 * @param {ToolCall[]} calls
 * @returns {Finding[]}
 */
function findParallelGroups(calls) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Set<string>} */
  const writtenPaths = new Set();

  let clusterStart = -1;
  /** @type {ToolCall[]} */
  let cluster = [];

  const flush = () => {
    if (cluster.length >= 2) {
      const savedRoundTrips = cluster.length - 1;
      findings.push({
        rule_id: "PARALLEL_GROUP",
        severity: RULE_BY_ID.get("PARALLEL_GROUP").severity,
        message: `${cluster.length} sequential read-only calls could batch (${savedRoundTrips} round-trip(s) saved)`,
        details: {
          tools: cluster.map((call) => call.tool),
          lines: cluster.map((call) => call.line),
          saved_round_trips: savedRoundTrips,
          turn_id: cluster[0].turnId,
        },
      });
    }
    clusterStart = -1;
    cluster = [];
  };

  for (const call of calls) {
    for (const path of call.writePaths) writtenPaths.add(path);

    const blockedByWrite = call.readPaths.some((path) => writtenPaths.has(path));
    const canParallel = call.readOnly && !blockedByWrite;

    if (canParallel) {
      if (cluster.length === 0) clusterStart = call.index;
      cluster.push(call);
      continue;
    }

    flush();
    for (const path of call.writePaths) writtenPaths.add(path);
  }

  flush();
  return findings;
}

/**
 * @param {ToolCall[]} calls
 * @returns {Finding[]}
 */
function findDuplicates(calls) {
  /** @type {Map<string, ToolCall[]>} */
  const groups = new Map();

  for (const call of calls) {
    const list = groups.get(call.fingerprint) ?? [];
    list.push(call);
    groups.set(call.fingerprint, list);
  }

  /** @type {Finding[]} */
  const findings = [];
  for (const [fingerprint, group] of groups.entries()) {
    if (group.length < 2) continue;
    findings.push({
      rule_id: "DUPLICATE_CALL",
      severity: RULE_BY_ID.get("DUPLICATE_CALL").severity,
      message: `${group[0].tool} called ${group.length} times with identical args`,
      details: {
        fingerprint,
        tool: group[0].tool,
        count: group.length,
        lines: group.map((call) => call.line),
      },
    });
  }

  return findings;
}

/**
 * @param {ToolCall[]} calls
 * @returns {Finding[]}
 */
function findStuckLoops(calls) {
  /** @type {Finding[]} */
  const findings = [];
  let streakTool = "";
  let streakFingerprint = "";
  /** @type {ToolCall[]} */
  let streak = [];

  const flush = () => {
    if (streak.length >= 3) {
      findings.push({
        rule_id: "STUCK_LOOP",
        severity: RULE_BY_ID.get("STUCK_LOOP").severity,
        message: `${streak[0].tool} repeated ${streak.length} times in a row with same args`,
        details: {
          tool: streak[0].tool,
          fingerprint: streakFingerprint,
          count: streak.length,
          lines: streak.map((call) => call.line),
        },
      });
    }
    streak = [];
    streakTool = "";
    streakFingerprint = "";
  };

  for (const call of calls) {
    if (call.fingerprint === streakFingerprint) {
      streak.push(call);
      continue;
    }
    flush();
    streakTool = call.tool;
    streakFingerprint = call.fingerprint;
    streak = [call];
  }

  flush();
  return findings;
}

/**
 * @param {Finding[]} findings
 * @param {number} toolCalls
 * @param {string[]} warnings
 */
export function formatJsonReport(findings, toolCalls, warnings) {
  const byRule = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  for (const finding of findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + 1;
  }

  const savedRoundTrips = findings
    .filter((f) => f.rule_id === "PARALLEL_GROUP")
    .reduce((sum, f) => sum + Number(f.details.saved_round_trips ?? 0), 0);

  return {
    summary: {
      tool_calls: toolCalls,
      findings: findings.length,
      rules_fired: findings.length,
      saved_round_trips: savedRoundTrips,
      warnings: warnings.length,
    },
    findings,
    warnings,
  };
}

/**
 * @param {Finding[]} findings
 */
export function formatFindings(findings) {
  if (findings.length === 0) {
    return "No sequential tool-call tax detected.";
  }

  return findings
    .map((finding) => `[${finding.severity}] ${finding.rule_id}: ${finding.message}`)
    .join("\n");
}

/**
 * @param {string[]|undefined} failOn
 */
export function normalizeFailOn(failOn) {
  if (failOn == null) {
    return new Set(RULES.map((rule) => rule.id));
  }
  const normalized = failOn.map((item) => item.trim().toUpperCase()).filter(Boolean);
  for (const id of normalized) {
    if (!RULE_BY_ID.has(id)) {
      throw new Error(`unknown rule in --fail-on: ${id}`);
    }
  }
  return new Set(normalized);
}

/**
 * @param {Finding[]} findings
 * @param {Set<string>|null} failOn
 */
export function shouldFail(findings, failOn) {
  if (findings.length === 0) return false;
  const active = failOn ?? new Set(RULES.map((rule) => rule.id));
  return findings.some((finding) => active.has(finding.rule_id));
}
