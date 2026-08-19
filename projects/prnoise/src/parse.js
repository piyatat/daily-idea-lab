/** @typedef {{ level: number, title: string, body: string, substance: number }} Section */

const BOILERPLATE_HEADINGS = [
  /^summary$/i,
  /^changes?$/i,
  /^testing$/i,
  /^test\s*plan$/i,
  /^checklist$/i,
  /^notes?$/i,
  /^ai[- ]generated$/i,
];

const RISK_HEADINGS = [
  /^risks?$/i,
  /^concerns?$/i,
  /^limitations?$/i,
  /^open\s*questions?$/i,
];

const TESTING_HEADINGS = [/^testing$/i, /^test\s*plan$/i];

export const SLOP_PHRASES = [
  "comprehensive",
  "robust",
  "seamlessly",
  "leverage",
  "delve",
  "utilize",
  "facilitate",
  "streamline",
  "enhance",
  "ensure",
  "it is important to note",
  "in order to",
  "a wide range of",
  "best practices",
  "cutting-edge",
  "holistic",
  "paradigm",
  "synergy",
  "empower",
  "transformative",
];

export const UNCERTAINTY_MARKERS = [
  /\bmight\b/i,
  /\bunsure\b/i,
  /\buncertain\b/i,
  /\bpossibly\b/i,
  /\bneed(s)? review\b/i,
  /\btodo verify\b/i,
  /\bverify\b/i,
  /\bassumption\b/i,
  /\bwip\b/i,
  /\bnot sure\b/i,
  /\?/,
];

export const NOT_TESTED_MARKERS = [
  /\bnot tested\b/i,
  /\bdidn'?t test\b/i,
  /\buntested\b/i,
  /\bmanual only\b/i,
  /\bskipped\b/i,
  /\btodo verify\b/i,
  /\bno (automated )?tests?\b/i,
];

/**
 * @param {string} text
 */
export function parsePrBody(text) {
  const lines = text.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  /** @type {Section[]} */
  const sections = [];
  let current = { level: 0, title: "", body: "", substance: 0 };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (current.title || current.body.trim()) {
        sections.push(finalizeSection(current));
      }
      current = {
        level: heading[1].length,
        title: heading[2].trim(),
        body: "",
        substance: 0,
      };
      continue;
    }
    current.body += `${line}\n`;
  }

  if (current.title || current.body.trim()) {
    sections.push(finalizeSection(current));
  }

  const checkedBoxes = (text.match(/^\s*-\s*\[[xX]\]/gm) ?? []).length;
  const uncheckedBoxes = (text.match(/^\s*-\s*\[[ ]\]/gm) ?? []).length;
  const h2h3Count = (text.match(/^#{2,3}\s+/gm) ?? []).length;

  const slopHits = SLOP_PHRASES.filter((phrase) =>
    text.toLowerCase().includes(phrase.toLowerCase()),
  );

  const uncertaintyHits = UNCERTAINTY_MARKERS.filter((pattern) => pattern.test(text));
  const notTestedHits = NOT_TESTED_MARKERS.filter((pattern) => pattern.test(text));

  const boilerplateSections = sections.filter((section) =>
    BOILERPLATE_HEADINGS.some((pattern) => pattern.test(section.title)),
  );

  const riskSections = sections.filter((section) =>
    RISK_HEADINGS.some((pattern) => pattern.test(section.title)),
  );

  const testingSections = sections.filter((section) =>
    TESTING_HEADINGS.some((pattern) => pattern.test(section.title)),
  );

  const templateTriplet = ["summary", "testing", "checklist"].every((name) =>
    sections.some((section) => section.title.toLowerCase().includes(name)),
  );

  return {
    text,
    lineCount: lines.length,
    nonEmptyLineCount: nonEmptyLines.length,
    charCount: text.length,
    sections,
    checkedBoxes,
    uncheckedBoxes,
    h2h3Count,
    slopHits,
    uncertaintyHits,
    notTestedHits,
    boilerplateSections,
    riskSections,
    testingSections,
    templateTriplet,
  };
}

/**
 * @param {{ level: number, title: string, body: string, substance: number }} section
 */
function finalizeSection(section) {
  const bodyLines = section.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const substance = bodyLines.join(" ").replace(/\s+/g, " ").trim().length;
  return { ...section, substance };
}

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

  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}
