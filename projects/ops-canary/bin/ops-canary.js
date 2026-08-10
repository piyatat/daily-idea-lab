#!/usr/bin/env node
import { run } from "../src/cli.js";

try {
  process.exitCode = await run();
} catch (error) {
  console.error(`ops-canary: ${error.message}`);
  process.exitCode = 1;
}
