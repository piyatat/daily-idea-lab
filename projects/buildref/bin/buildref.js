#!/usr/bin/env node
import { run } from "../src/cli.js";

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(`buildref: ${error.message}`);
  process.exitCode = 2;
}
