import { scanFile } from "./scan.js";
import { RULES } from "./rules.js";

const HELP = `greensweep — catch agent runs that report success but produce zero real output

Usage:
  greensweep scan <run.jsonl> [options]
  greensweep rules

Commands:
  scan     Analyze JSONL run receipts for silent-green failure patterns
  rules    List rule IDs and descriptions

Scan options:
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: all)
  -h, --help             Show help

Rules:
  ZERO_BYTES         Success with zero bytes and no artifacts
  MISSING_ARTIFACTS  Success but required outputs are absent or empty
  NO_TOOL_CALLS      Success with no tool activity or file changes
  STATUS_ONLY        Only lifecycle/status events, no substantive work

Examples:
  greensweep scan fixtures/clean-run.jsonl
  greensweep scan run.jsonl --json
  greensweep scan run.jsonl --fail-on ZERO_BYTES,STATUS_ONLY
`;

/**
 * @param {string[]} argv
 */
export async function run(argv) {
  const args = [...argv];
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(HELP.trim());
    return 0;
  }

  const command = args.shift();
  if (command === "rules") {
    for (const rule of RULES) {
      console.log(`${rule.id}\t[${rule.severity}]\t${rule.message}`);
    }
    return 0;
  }

  if (command !== "scan") {
    throw new Error(`unknown command: ${command}`);
  }

  if (args.length === 0 || args[0].startsWith("-")) {
    throw new Error("scan requires a run.jsonl path");
  }

  const filePath = args.shift();
  let asJson = false;
  /** @type {string[]|undefined} */
  let failOn;

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--json":
        asJson = true;
        break;
      case "--fail-on":
        failOn = readList(args.shift(), "--fail-on");
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }

  const result = scanFile(filePath, { asJson, failOn });

  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`);
  }

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
    if (result.findings.length > 0) {
      console.log(`\nScanned ${result.report.summary.runs_scanned} run(s); ${result.findings.length} finding(s).`);
    }
  }

  return result.exitCode;
}

/** @param {string|undefined} value @param {string} flag */
function readList(value, flag) {
  if (value == null || !value.trim()) {
    throw new Error(`${flag} requires a comma-separated rule list`);
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
