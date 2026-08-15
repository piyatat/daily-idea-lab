import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * @typedef {{ id: string, name?: string, line: number }} InsertRow
 * @typedef {{ id: string, line: number, kind: 'override' }} OverrideRow
 * @typedef {{ rows: InsertRow[], line: number }} InsertBlock
 * @typedef {{ inserts: InsertBlock[], overrides: OverrideRow[], raw: string }} PatchDocument
 * @typedef {{ bundle?: { patch?: string }, profile?: { bundles?: string[] } }} DshManifest
 */

/**
 * @param {string} filePath
 */
export function readPatchFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  return { ...parsePatchYaml(raw), raw, filePath };
}

/**
 * Minimal Cordis patch parser for dsh bundle files (zero-dep subset).
 * @param {string} raw
 */
export function parsePatchYaml(raw) {
  /** @type {InsertBlock[]} */
  const inserts = [];
  /** @type {OverrideRow[]} */
  const overrides = [];
  const lines = raw.split(/\r?\n/);

  /** @type {InsertBlock|null} */
  let currentInsert = null;
  /** @type {Partial<InsertRow>|null} */
  let currentRow = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^- insert:\s*$/.test(trimmed)) {
      currentInsert = { rows: [], line: lineNo };
      inserts.push(currentInsert);
      currentRow = null;
      continue;
    }

    const overrideMatch = trimmed.match(/^- id:\s*(.+)$/);
    if (overrideMatch && !line.startsWith("    ")) {
      currentRow = null;
      overrides.push({ id: stripQuotes(overrideMatch[1]), line: lineNo, kind: "override" });
      continue;
    }

    const rowStart = trimmed.match(/^- id:\s*(.+)$/);
    if (rowStart && currentInsert) {
      if (currentRow?.id) {
        currentInsert.rows.push(/** @type {InsertRow} */ (currentRow));
      }
      currentRow = { id: stripQuotes(rowStart[1]), line: lineNo };
      continue;
    }

    const nameMatch = trimmed.match(/^name:\s*(.+)$/);
    if (nameMatch && currentRow) {
      currentRow.name = stripQuotes(nameMatch[1]);
    }
  }

  if (currentRow?.id && currentInsert) {
    currentInsert.rows.push(/** @type {InsertRow} */ (currentRow));
  }

  return { inserts, overrides };
}

/** @param {string} value */
function stripQuotes(value) {
  const v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * @param {string} dir
 */
export function loadPackageManifest(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`missing package.json in ${dir}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  /** @type {DshManifest|undefined} */
  const dsh = pkg.dsh;
  return { pkgPath, pkg, dsh, dir };
}

/**
 * Resolve patch path relative to package directory.
 * @param {string} dir
 * @param {string} patchRef
 */
export function resolvePatchPath(dir, patchRef) {
  return resolve(dir, patchRef);
}

/**
 * @param {string} patchPath
 */
export function patchDir(patchPath) {
  return dirname(patchPath);
}
