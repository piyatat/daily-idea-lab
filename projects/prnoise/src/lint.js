import { parsePrBody, readInput } from "./parse.js";
import {
  evaluateRules,
  formatFindings,
  formatJsonReport,
  normalizeFailOn,
  shouldFail,
} from "./rules.js";

/**
 * @param {string} text
 * @param {{ diffLines?: number|undefined }} options
 */
export function lintText(text, options = {}) {
  const parsed = parsePrBody(text);
  const findings = evaluateRules({ parsed, diffLines: options.diffLines });
  return { parsed, findings };
}

/**
 * @param {string} filePath
 * @param {{ asJson?: boolean, failOn?: string[]|undefined, diffLines?: number|undefined }} options
 */
export async function lintFile(filePath, options = {}) {
  const text = await readInput(filePath);
  const { parsed, findings } = lintText(text, { diffLines: options.diffLines });
  const failOn = normalizeFailOn(options.failOn);
  const report = formatJsonReport(findings, parsed.lineCount);

  return {
    findings,
    report,
    exitCode: shouldFail(findings, failOn) ? 1 : 0,
    text: formatFindings(findings),
  };
}
