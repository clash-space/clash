import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

async function collectTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const tests = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...(await collectTests(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(relative(packageRoot, fullPath));
    }
  }

  return tests;
}

const tests = (await collectTests(sourceRoot)).sort();

if (tests.length === 0) {
  console.error("No CLI test files found.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...tests], {
  cwd: packageRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`CLI tests terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
