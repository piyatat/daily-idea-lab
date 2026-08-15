import { resolve } from "node:path";
import { readPatchFile } from "./parse.js";
import { evaluateStackRules, shouldFail } from "./rules.js";

/**
 * @param {string[]} patchPaths
 * @param {{ asJson?: boolean, failOn?: string[] }} [options]
 */
export function checkStack(patchPaths, options = {}) {
  const layers = patchPaths.map((p) => readPatchFile(resolve(p)));
  const findings = evaluateStackRules(layers);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const exitCode = shouldFail(findings, options.failOn) ? 1 : 0;

  const report = {
    tool: "dsplug",
    mode: "stack",
    layers: layers.map((l) => l.filePath),
    summary: { findings: findings.length, errors, warnings },
    findings,
  };

  let text = `dsplug · stack · ${layers.length} layer(s)\n`;
  for (const layer of layers) {
    text += `  - ${layer.filePath}\n`;
  }
  if (findings.length === 0) {
    text += "OK — stack resolves cleanly\n";
  } else {
    text += "\n";
    for (const f of findings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file ?? "";
      text += `[${f.severity.toUpperCase()}] ${f.rule_id} @ ${loc}\n         ${f.message}\n`;
      if (f.details && Object.keys(f.details).length > 0) {
        text += `         ${JSON.stringify(f.details)}\n`;
      }
    }
    text += `\n${findings.length} finding(s); ${errors} error(s); ${warnings} warning(s).`;
  }

  return { findings, report, text, exitCode, warnings: [] };
}
