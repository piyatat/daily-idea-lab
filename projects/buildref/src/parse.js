import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * @typedef {Object} CargoManifest
 * @property {string} path
 * @property {string} relPath
 * @property {boolean} hasBuildScript
 * @property {string|undefined} buildScriptPath
 * @property {Record<string, string>} buildDependencies
 * @property {Record<string, string>} dependencies
 * @property {string[]} packageNames
 */

/**
 * @typedef {Object} BuildScript
 * @property {string} path
 * @property {string} relPath
 * @property {string} content
 * @property {number} lineCount
 */

/**
 * @typedef {Object} LockPackage
 * @property {string} name
 * @property {string} version
 * @property {string} source
 * @property {boolean} hasBuildScript
 */

/**
 * @typedef {Object} ParsedProject
 * @property {string} root
 * @property {CargoManifest[]} manifests
 * @property {BuildScript[]} buildScripts
 * @property {LockPackage[]} lockPackages
 * @property {string|undefined} lockPath
 */

/**
 * @param {string} filePath
 */
export async function readInput(filePath) {
  if (filePath === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(filePath, "utf8");
}

/**
 * @param {string} content
 */
export function parseTomlSectionDeps(content, sectionName) {
  /** @type {Record<string, string>} */
  const deps = {};
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRe = new RegExp(`\\[${escaped}\\]\\s*([\\s\\S]*?)(?=\\n\\[|$)`);
  const match = content.match(sectionRe);
  if (!match) return deps;

  const lines = match[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const inline = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (inline) {
      deps[inline[1]] = inline[2];
      continue;
    }
    const table = trimmed.match(/^([A-Za-z0-9_-]+)\.version\s*=\s*"([^"]+)"/);
    if (table) {
      deps[table[1]] = table[2];
    }
  }
  return deps;
}

/**
 * @param {string} content
 * @param {string} relPath
 */
export function parseCargoManifest(content, relPath) {
  const packageMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
  const buildMatch = content.match(/^\s*build\s*=\s*"([^"]+)"/m);
  const hasBuildScript = Boolean(buildMatch) || content.includes("[build-dependencies]");

  return {
    path: relPath,
    relPath,
    hasBuildScript,
    buildScriptPath: buildMatch?.[1],
    buildDependencies: parseTomlSectionDeps(content, "build-dependencies"),
    dependencies: {
      ...parseTomlSectionDeps(content, "dependencies"),
      ...parseTomlSectionDeps(content, "dev-dependencies"),
    },
    packageNames: packageMatch ? [packageMatch[1]] : [],
  };
}

/**
 * @param {string} content
 */
export function parseCargoLock(content) {
  /** @type {LockPackage[]} */
  const packages = [];
  const blocks = content.split(/\n\[\[package\]\]\n/).slice(1);
  for (const block of blocks) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (!name || !version) continue;
    const source = block.match(/^source\s*=\s*"([^"]+)"/m)?.[1] ?? "path";
    packages.push({
      name,
      version,
      source,
      hasBuildScript: /\nbuild\s*=\s*\[/.test(block) || block.includes('build = "'),
    });
  }
  return packages;
}

/**
 * @param {string} dir
 * @param {string} root
 */
async function walkForCargo(dir, root) {
  /** @type {string[]} */
  const manifests = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "target" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await walkForCargo(full, root)));
      continue;
    }
    if (entry.name === "Cargo.toml") {
      manifests.push(full);
    }
  }
  return manifests;
}

/**
 * @param {string} scanPath
 */
export async function parseProject(scanPath) {
  const rootStat = await stat(scanPath);
  const root = rootStat.isDirectory() ? scanPath : join(scanPath, "..");

  const manifestPaths = rootStat.isDirectory()
    ? await walkForCargo(scanPath, scanPath)
    : scanPath.endsWith("Cargo.toml")
      ? [scanPath]
      : [];

  /** @type {CargoManifest[]} */
  const manifests = [];
  /** @type {BuildScript[]} */
  const buildScripts = [];

  for (const manifestPath of manifestPaths) {
    const content = await readFile(manifestPath, "utf8");
    const relPath = relative(root, manifestPath);
    const manifest = parseCargoManifest(content, relPath);
    manifest.path = manifestPath;
    manifests.push(manifest);

    const manifestDir = join(manifestPath, "..");
    const buildRsPath = join(manifestDir, manifest.buildScriptPath ?? "build.rs");
    try {
      const buildContent = await readFile(buildRsPath, "utf8");
      buildScripts.push({
        path: buildRsPath,
        relPath: relative(root, buildRsPath),
        content: buildContent,
        lineCount: buildContent.split("\n").length,
      });
    } catch {
      // no build.rs
    }
  }

  let lockPath;
  /** @type {LockPackage[]} */
  let lockPackages = [];
  const lockCandidate = join(rootStat.isDirectory() ? scanPath : join(scanPath, ".."), "Cargo.lock");
  try {
    const lockStat = await stat(lockCandidate);
    if (lockStat.isFile()) {
      lockPath = lockCandidate;
      lockPackages = parseCargoLock(await readFile(lockCandidate, "utf8"));
    }
  } catch {
    // no lockfile
  }

  return {
    root,
    manifests,
    buildScripts,
    lockPackages,
    lockPath: lockPath ? relative(root, lockPath) : undefined,
  };
}
