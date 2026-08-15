import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadPackageManifest, readPatchFile, resolvePatchPath } from "./parse.js";
import { evaluateManifestRules, evaluatePatchRules, shouldFail } from "./rules.js";

/**
 * @param {string} targetDir
 * @param {{ asJson?: boolean, failOn?: string[] }} [options]
 */
export function checkDirectory(targetDir, options = {}) {
  const dir = resolve(targetDir);
  const { pkgPath, dsh } = loadPackageManifest(dir);

  /** @type {import('./rules.js').Finding[]} */
  let findings = evaluateManifestRules(dsh, pkgPath, dir);

  if (typeof dsh?.bundle?.patch === "string") {
    const patchPath = resolvePatchPath(dir, dsh.bundle.patch);
    if (existsSync(patchPath)) {
      const patch = readPatchFile(patchPath);
      findings = findings.concat(evaluatePatchRules(patch, patchPath));
    }
  }

  return formatResult(findings, { target: dir, mode: "check", ...options });
}

/**
 * @param {string} patchPath
 * @param {{ asJson?: boolean, failOn?: string[] }} [options]
 */
export function checkPatchFile(patchPath, options = {}) {
  const resolved = resolve(patchPath);
  const patch = readPatchFile(resolved);
  const findings = evaluatePatchRules(patch, resolved);
  return formatResult(findings, { target: resolved, mode: "patch", ...options });
}

/**
 * @param {import('./rules.js').Finding[]} findings
 * @param {{ target: string, mode: string, asJson?: boolean, failOn?: string[] }} ctx
 */
function formatResult(findings, ctx) {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const exitCode = shouldFail(findings, ctx.failOn) ? 1 : 0;

  const report = {
    tool: "dsplug",
    mode: ctx.mode,
    target: ctx.target,
    summary: { findings: findings.length, errors, warnings },
    findings,
  };

  let text = `dsplug · ${ctx.mode} · ${ctx.target}\n`;
  if (findings.length === 0) {
    text += "OK — no findings\n";
  } else {
    for (const f of findings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file ?? ctx.target;
      text += `[${f.severity.toUpperCase()}] ${f.rule_id} @ ${loc}\n         ${f.message}\n`;
      if (f.details && Object.keys(f.details).length > 0) {
        text += `         ${JSON.stringify(f.details)}\n`;
      }
    }
    text += `\n${findings.length} finding(s); ${errors} error(s); ${warnings} warning(s).`;
  }

  return { findings, report, text, exitCode, warnings: [] };
}
