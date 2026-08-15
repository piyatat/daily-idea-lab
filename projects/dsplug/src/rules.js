import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** @typedef {'error'|'warning'|'info'} Severity */

/**
 * @typedef {{
 *   rule_id: string,
 *   severity: Severity,
 *   message: string,
 *   file?: string,
 *   line?: number,
 *   details?: Record<string, unknown>
 * }} Finding
 */

/** @type {{ id: string, severity: Severity, message: string }[]} */
export const RULES = [
  {
    id: "DUPLICATE_ROW_ID",
    severity: "error",
    message: "Duplicate plugin row id in the same patch file",
  },
  {
    id: "MISSING_PATCH_FILE",
    severity: "error",
    message: "package.json dsh.bundle.patch points to a missing file",
  },
  {
    id: "MISSING_ROW_ID",
    severity: "error",
    message: "Insert row is missing an id field",
  },
  {
    id: "MISSING_ROW_NAME",
    severity: "error",
    message: "Insert row is missing a name (npm package) field",
  },
  {
    id: "EMPTY_INSERT",
    severity: "error",
    message: "Insert block declares no plugin rows",
  },
  {
    id: "UNSCOPED_PLUGIN_NAME",
    severity: "warning",
    message: "Plugin name is not a scoped npm package (@scope/name)",
  },
  {
    id: "UNRESOLVED_TARGET",
    severity: "error",
    message: "Patch overrides a row id not present in earlier stack layers",
  },
  {
    id: "MALFORMED_DSH",
    severity: "error",
    message: "package.json dsh field has an invalid shape",
  },
  {
    id: "ORPHAN_PATCH",
    severity: "warning",
    message: "cordis.patch.yml exists but package.json has no dsh metadata",
  },
  {
    id: "MISSING_DSH_MANIFEST",
    severity: "info",
    message: "Directory has no dsh bundle/profile metadata to validate",
  },
];

/**
 * @param {Finding[]} findings
 * @param {string[]|undefined} failOn
 */
export function shouldFail(findings, failOn) {
  const ids = normalizeFailOn(failOn);
  return findings.some((f) => ids.includes(f.rule_id) && f.severity === "error");
}

/** @param {string[]|undefined} failOn */
export function normalizeFailOn(failOn) {
  if (!failOn || failOn.length === 0) {
    return RULES.filter((r) => r.severity === "error").map((r) => r.id);
  }
  return failOn;
}

/**
 * @param {import('./parse.js').PatchDocument & { filePath?: string }} patch
 * @param {string} [filePath]
 */
export function evaluatePatchRules(patch, filePath = patch.filePath) {
  /** @type {Finding[]} */
  const findings = [];
  const seenIds = new Map();

  for (const block of patch.inserts) {
    if (block.rows.length === 0) {
      findings.push(makeFinding("EMPTY_INSERT", filePath, block.line, { block: block.line }));
    }
    for (const row of block.rows) {
      if (!row.id?.trim()) {
        findings.push(makeFinding("MISSING_ROW_ID", filePath, row.line));
        continue;
      }
      if (seenIds.has(row.id)) {
        findings.push(makeFinding("DUPLICATE_ROW_ID", filePath, row.line, {
          id: row.id,
          first_line: seenIds.get(row.id),
        }));
      } else {
        seenIds.set(row.id, row.line);
      }
      if (!row.name?.trim()) {
        findings.push(makeFinding("MISSING_ROW_NAME", filePath, row.line, { id: row.id }));
      } else if (!/^@[^/]+\/[^/]+/.test(row.name)) {
        findings.push(makeFinding("UNSCOPED_PLUGIN_NAME", filePath, row.line, {
          id: row.id,
          name: row.name,
        }));
      }
    }
  }

  return findings;
}

/**
 * @param {Array<import('./parse.js').PatchDocument & { filePath: string }>} layers
 */
export function evaluateStackRules(layers) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Set<string>} */
  const known = new Set();

  for (const layer of layers) {
    findings.push(...evaluatePatchRules(layer, layer.filePath));

    for (const id of insertedIdsFromPatch(layer)) {
      known.add(id);
    }

    for (const override of layer.overrides) {
      if (!known.has(override.id)) {
        findings.push(makeFinding("UNRESOLVED_TARGET", layer.filePath, override.line, {
          id: override.id,
        }));
      }
    }
  }

  return dedupeFindings(findings);
}

/** @param {import('./parse.js').PatchDocument} patch */
function insertedIdsFromPatch(patch) {
  const ids = new Set();
  for (const block of patch.inserts) {
    for (const row of block.rows) {
      if (row.id) ids.add(row.id);
    }
  }
  return ids;
}

/**
 * @param {string} ruleId
 * @param {string|undefined} file
 * @param {number|undefined} line
 * @param {Record<string, unknown>} [details]
 */
function makeFinding(ruleId, file, line, details = {}) {
  const rule = RULES.find((r) => r.id === ruleId);
  return {
    rule_id: ruleId,
    severity: rule?.severity ?? "error",
    message: rule?.message ?? ruleId,
    file,
    line,
    details,
  };
}

/** @param {Finding[]} findings */
function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.rule_id}:${f.file}:${f.line}:${JSON.stringify(f.details)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {import('./parse.js').DshManifest|undefined} dsh
 * @param {string} pkgPath
 * @param {string} dir
 */
export function evaluateManifestRules(dsh, pkgPath, dir) {
  /** @type {Finding[]} */
  const findings = [];
  const patchInTree = existsSync(resolve(dir, "cordis.patch.yml"));

  if (!dsh) {
    if (patchInTree) {
      findings.push({
        rule_id: "ORPHAN_PATCH",
        severity: "warning",
        message: "cordis.patch.yml exists but package.json has no dsh metadata",
        file: pkgPath,
      });
    } else {
      findings.push({
        rule_id: "MISSING_DSH_MANIFEST",
        severity: "info",
        message: "Directory has no dsh bundle/profile metadata to validate",
        file: pkgPath,
      });
    }
    return findings;
  }

  if (dsh.bundle?.patch != null && typeof dsh.bundle.patch !== "string") {
    findings.push(makeManifestFinding("MALFORMED_DSH", pkgPath, { field: "dsh.bundle.patch" }));
  }

  if (dsh.profile?.bundles != null && !Array.isArray(dsh.profile.bundles)) {
    findings.push(makeManifestFinding("MALFORMED_DSH", pkgPath, { field: "dsh.profile.bundles" }));
  }

  if (typeof dsh.bundle?.patch === "string") {
    const patchPath = resolve(dir, dsh.bundle.patch);
    if (!existsSync(patchPath)) {
      findings.push({
        rule_id: "MISSING_PATCH_FILE",
        severity: "error",
        message: "package.json dsh.bundle.patch points to a missing file",
        file: pkgPath,
        details: { patch: dsh.bundle.patch, resolved: patchPath },
      });
    }
  }

  return findings;
}

/** @param {string} ruleId @param {string} file @param {Record<string, unknown>} details */
function makeManifestFinding(ruleId, file, details) {
  const rule = RULES.find((r) => r.id === ruleId);
  return {
    rule_id: ruleId,
    severity: rule?.severity ?? "error",
    message: rule?.message ?? ruleId,
    file,
    details,
  };
}
