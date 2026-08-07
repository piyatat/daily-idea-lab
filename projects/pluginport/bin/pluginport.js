#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js')
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
