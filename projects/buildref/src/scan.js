import { parseProject } from "./parse.js";
import {
  evaluateRules,
  formatFindings,
  formatJsonReport,
  normalizeFailOn,
  shouldFail,
} from "./rules.js";

/**
 * @param {string} scanPath
 * @param {{ asJson?: boolean, failOn?: string[]|undefined }} options
 */
export async function scanPath(scanPath, options = {}) {
  const project = await parseProject(scanPath);
  const findings = evaluateRules(project);
  const failOn = normalizeFailOn(options.failOn);
  const report = formatJsonReport(findings, project.manifests.length);

  return {
    project,
    findings,
    report,
    exitCode: shouldFail(findings, failOn) ? 1 : 0,
    text: formatFindings(findings),
  };
}
