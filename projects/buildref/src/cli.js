import { scanPath } from "./scan.js";
import { RULES, explainRule } from "./rules.js";

const HELP = `buildref — fail-closed linter for Rust build-script supply-chain bait

Usage:
  buildref scan [path] [options]
  buildref rules
  buildref explain <rule-id>

Commands:
  scan      Scan Cargo.toml, build.rs, and Cargo.lock under path (default: .)
  rules     List rule IDs, severities, and descriptions
  explain   Show remediation guidance for one rule

Scan options:
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: error severity)
  -h, --help             Show help

Examples:
  buildref scan fixtures/benign
  buildref scan . --json --fail-on BUILD_NET_FETCH,BUILD_SHELL_EXEC
  buildref explain LOCK_BAIT_BUILD_DEP
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

  let scanTarget = ".";
  if (args.length > 0 && !args[0].startsWith("-")) {
    scanTarget = args.shift() ?? ".";
  }

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
        failOn = (args.shift() ?? "").split(",").filter(Boolean);
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  const result = await scanPath(scanTarget, { asJson, failOn });
  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
  }
  return result.exitCode;
}
