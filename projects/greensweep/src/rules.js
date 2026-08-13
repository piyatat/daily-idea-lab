/** @typedef {import("./parse.js").RunRecord} RunRecord */

/** @typedef {object} RuleDefinition
 * @property {string} id
 * @property {string} severity
 * @property {string} message
 */

/** @typedef {object} Finding
 * @property {string} rule_id
 * @property {string} severity
 * @property {string} message
 * @property {string} run_id
 * @property {number} line
 */

/** @type {RuleDefinition[]} */
export const RULES = [
  {
    id: "ZERO_BYTES",
    severity: "critical",
    message: "Success with zero bytes and no artifacts",
  },
  {
    id: "MISSING_ARTIFACTS",
    severity: "high",
    message: "Success but required outputs are absent or empty",
  },
  {
    id: "NO_TOOL_CALLS",
    severity: "high",
    message: "Success with no tool activity or file changes",
  },
  {
    id: "STATUS_ONLY",
    severity: "medium",
    message: "Green shell — only lifecycle/status events, no substantive work",
  },
];

const STATUS_ONLY_PATTERN = /^(status|lifecycle|heartbeat|ping|started|finished|completed|success)$/i;

/**
 * @param {RunRecord} record
 * @returns {Finding[]}
 */
export function evaluateRules(record) {
  if (record.status !== "success") return [];

  /** @type {Finding[]} */
  const findings = [];

  if (record.bytes_out === 0 && record.artifacts.length === 0) {
    findings.push(makeFinding("ZERO_BYTES", record));
  }

  if (record.expects_artifacts && record.artifacts.length === 0) {
    findings.push(makeFinding("MISSING_ARTIFACTS", record));
  } else if (record.artifacts.some((artifact) => isEmptyArtifact(artifact))) {
    findings.push(makeFinding("MISSING_ARTIFACTS", record));
  }

  if (record.tool_calls === 0 && record.files_touched === 0) {
    findings.push(makeFinding("NO_TOOL_CALLS", record));
  }

  if (record.events.length > 0 && record.events.every(isStatusOnlyEvent)) {
    findings.push(makeFinding("STATUS_ONLY", record));
  }

  return findings;
}

/**
 * @param {string} ruleId
 * @param {RunRecord} record
 * @returns {Finding}
 */
function makeFinding(ruleId, record) {
  const rule = RULES.find((item) => item.id === ruleId);
  return {
    rule_id: ruleId,
    severity: rule?.severity ?? "medium",
    message: rule?.message ?? ruleId,
    run_id: record.run_id,
    line: record.line,
  };
}

/** @param {string} artifact */
function isEmptyArtifact(artifact) {
  return artifact === "" || artifact.endsWith("/") || artifact === "(missing)";
}

/** @param {string} event */
function isStatusOnlyEvent(event) {
  const token = event.split(":")[0]?.trim() ?? event.trim();
  return STATUS_ONLY_PATTERN.test(token) || STATUS_ONLY_PATTERN.test(event.trim());
}

/**
 * @param {string[]|undefined} filter
 * @returns {Set<string>|null}
 */
export function normalizeFailOn(filter) {
  if (!filter || filter.length === 0) return null;
  return new Set(filter.map((item) => item.trim()).filter(Boolean));
}

/**
 * @param {Finding[]} findings
 * @param {Set<string>|null} failOn
 */
export function shouldFail(findings, failOn) {
  if (findings.length === 0) return false;
  if (!failOn) return true;
  return findings.some((finding) => failOn.has(finding.rule_id));
}

/**
 * @param {Finding[]} findings
 */
export function formatFindings(findings) {
  if (findings.length === 0) {
    return "No silent-green findings.";
  }

  const lines = ["Findings:"];
  for (const finding of findings) {
    lines.push(
      `  [${finding.severity}] ${finding.rule_id} run=${finding.run_id} line=${finding.line} — ${finding.message}`,
    );
  }
  return lines.join("\n");
}

/**
 * @param {Finding[]} findings
 * @param {number} runsScanned
 * @param {string[]} warnings
 */
export function formatJsonReport(findings, runsScanned, warnings) {
  const byRule = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  for (const finding of findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + 1;
  }

  return {
    findings,
    warnings,
    summary: {
      runs_scanned: runsScanned,
      rules_fired: findings.length,
      by_rule: byRule,
    },
  };
}
