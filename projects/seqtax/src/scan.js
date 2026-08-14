import { loadToolCalls } from "./parse.js";
import {
  evaluateRules,
  formatFindings,
  formatJsonReport,
  normalizeFailOn,
  shouldFail,
} from "./rules.js";

/**
 * @param {import("./parse.js").ToolCall[]} calls
 */
export function scanCalls(calls) {
  return evaluateRules(calls);
}

/**
 * @param {string} filePath
 * @param {{ asJson?: boolean, failOn?: string[]|undefined }} options
 */
export function scanFile(filePath, options = {}) {
  const { calls, warnings } = loadToolCalls(filePath);
  const failOn = normalizeFailOn(options.failOn);
  const findings = scanCalls(calls);

  const report = formatJsonReport(findings, calls.length, warnings);
  return {
    findings,
    warnings,
    report,
    exitCode: shouldFail(findings, failOn) ? 1 : 0,
    text: formatFindings(findings),
  };
}
