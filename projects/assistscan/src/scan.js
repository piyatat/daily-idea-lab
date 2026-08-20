import path from "node:path";
import { walkFiles, readTextFile } from "./walk.js";
import {
  daysUntilShutdown,
  formatJsonReport,
  formatMatches,
  normalizeFailOn,
  scanText,
  shouldFail,
} from "./rules.js";

/**
 * @param {string} root
 * @param {{ ignore?: Set<string> }} [options]
 */
export async function scanDirectory(root, options = {}) {
  const absRoot = path.resolve(root);
  const files = await walkFiles(absRoot, { ignore: options.ignore });
  /** @type {import("./rules.js").Match[]} */
  const matches = [];
  let scannedLines = 0;

  for (const file of files) {
    const rel = path.relative(absRoot, file) || file;
    let text;
    try {
      text = await readTextFile(file);
    } catch {
      continue;
    }
    scannedLines += text.split(/\r?\n/).length;
    matches.push(...scanText(text, rel));
  }

  matches.sort((a, b) => {
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    return a.line - b.line;
  });

  return {
    matches,
    stats: {
      scanned_files: files.length,
      scanned_lines: scannedLines,
      days_until_shutdown: daysUntilShutdown(),
    },
  };
}

/**
 * @param {string} root
 * @param {{ asJson?: boolean, failOn?: string[]|undefined, ignore?: Set<string> }} [options]
 */
export async function scanPath(root, options = {}) {
  const { matches, stats } = await scanDirectory(root, { ignore: options.ignore });
  const failOn = normalizeFailOn(options.failOn);
  const report = formatJsonReport(matches, stats);

  return {
    matches,
    report,
    exitCode: shouldFail(matches, failOn) ? 1 : 0,
    text: formatMatches(matches),
    banner: `OpenAI Assistants API shutdown in ${stats.days_until_shutdown} day(s) (${report.shutdown_date}). Scanned ${stats.scanned_files} file(s), ${stats.scanned_lines} line(s).`,
  };
}
