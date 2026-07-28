#!/usr/bin/env node

import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const distDir = resolve(
  process.env.CLASH_BRIDGE_DIST_DIR || join(packageRoot, "dist"),
);

let entries = [];
try {
  entries = await readdir(distDir);
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

await Promise.all(
  entries
    .filter((entry) => entry !== "agents")
    .map((entry) => rm(join(distDir, entry), { recursive: true, force: true })),
);
