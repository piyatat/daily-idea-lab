import { scanPath } from "./scan.js";
import { RULES, explainRule, daysUntilShutdown, SHUTDOWN_DATE } from "./rules.js";

const HELP = `assistscan — fail-closed scanner for OpenAI Assistants API call sites

The Assistants API shuts down permanently on ${SHUTDOWN_DATE.toISOString().slice(0, 10)}.
There is no grace period and no automated Thread→Conversation migration.

Usage:
  assistscan scan [path] [options]
  assistscan rules
  assistscan explain <rule-id>
  assistscan deadline

Commands:
  scan       Scan a directory tree for deprecated Assistants API call sites (default: .)
  rules      List rule IDs, severities, and descriptions
  explain    Show remediation guidance for one rule
  deadline   Print days remaining until shutdown

Scan options:
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: error severity)
  --ignore <dir>         Extra directory name to skip (repeatable)
  -h, --help             Show help

Examples:
  assistscan scan .
  assistscan scan ./src --json --fail-on BETA_THREADS,V1_THREADS_URL
  assistscan deadline
  assistscan explain BETA_ASSISTANTS
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

  if (command === "deadline") {
    const days = daysUntilShutdown();
    console.log(`Assistants API shutdown: ${SHUTDOWN_DATE.toISOString().slice(0, 10)} (${days} day(s) remaining)`);
    return days === 0 ? 1 : 0;
  }

  if (command === "explain") {
    const ruleId = args.shift();
    if (!ruleId) {
      throw new Error("explain requires a rule id");
    }
    const info = explainRule(ruleId);
    console.log(`${info.id} [${info.severity}]`);
    console.log(info.message);
    console.log(`\nRemediation: ${info.remediation}`);
    return 0;
  }

  if (command !== "scan") {
    throw new Error(`unknown command: ${command}`);
  }

  let scanPathArg = ".";
  if (args.length > 0 && !args[0].startsWith("-")) {
    scanPathArg = args.shift() ?? ".";
  }

  let asJson = false;
  /** @type {string[]|undefined} */
  let failOn;
  /** @type {Set<string>} */
  const ignore = new Set();

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--json":
        asJson = true;
        break;
      case "--fail-on":
        failOn = (args.shift() ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        break;
      case "--ignore":
        ignore.add(args.shift() ?? "");
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  const result = await scanPath(scanPathArg, { asJson, failOn, ignore: ignore.size ? ignore : undefined });
  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.banner);
    console.log("");
    console.log(result.text);
  }
  return result.exitCode;
}
