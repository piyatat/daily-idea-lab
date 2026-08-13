import { loadRecords } from "./parse.js";
import {
  evaluateRules,
  formatFindings,
  formatJsonReport,
  normalizeFailOn,
  shouldFail,
} from "./rules.js";

/**
 * @param {import("./parse.js").RunRecord[]} records
 */
export function scanRecords(records) {
  /** @type {import("./rules.js").Finding[]} */
  const findings = [];

  for (const record of records) {
    findings.push(...evaluateRules(record));
  }

  return findings;
}

/**
 * @param {string} filePath
 * @param {{ asJson?: boolean, failOn?: string[]|undefined }} options
 */
export function scanFile(filePath, options = {}) {
  const { records, warnings } = loadRecords(filePath);
  const failOn = normalizeFailOn(options.failOn);
  const findings = scanRecords(records);

  const report = formatJsonReport(findings, records.length, warnings);
  return {
    findings,
    warnings,
    report,
    exitCode: shouldFail(findings, failOn) ? 1 : 0,
    text: formatFindings(findings),
  };
}
