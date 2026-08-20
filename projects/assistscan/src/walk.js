import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

const SCAN_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".cs",
  ".php",
  ".rs",
  ".swift",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".env",
  ".md",
  ".sh",
]);

/**
 * @param {string} root
 * @param {{ ignore?: Set<string>, maxFileBytes?: number }} [options]
 */
export async function walkFiles(root, options = {}) {
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const maxFileBytes = options.maxFileBytes ?? 512_000;
  /** @type {string[]} */
  const files = [];

  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignore.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTENSIONS.has(ext) && entry.name !== "Dockerfile") {
        continue;
      }
      try {
        const info = await stat(fullPath);
        if (info.size > maxFileBytes) {
          continue;
        }
        files.push(fullPath);
      } catch {
        // skip unreadable files
      }
    }
  }

  await visit(root);
  files.sort();
  return files;
}

/**
 * @param {string} filePath
 */
export async function readTextFile(filePath) {
  return readFile(filePath, "utf8");
}
