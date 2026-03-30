#!/usr/bin/env node
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use tsx to run TypeScript source directly
const { execSync } = await import('node:child_process');
const tsxBin = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
const entry = join(__dirname, '..', 'src', 'index.ts');

import { spawnSync } from 'node:child_process';
const result = spawnSync(tsxBin, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
