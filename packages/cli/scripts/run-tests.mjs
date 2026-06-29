import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
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

const nodeTests = [];
const vitestTests = [];
for (const test of tests) {
  const source = await readFile(join(packageRoot, test), "utf8");
  if (source.includes("from \"vitest\"") || source.includes("from 'vitest'")) {
    vitestTests.push(test);
  } else {
    nodeTests.push(test);
  }
}

function run(label, command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        console.error(`${label} terminated by ${signal}.`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

if (nodeTests.length > 0) {
  const code = await run("CLI node tests", process.execPath, ["--import", "tsx", "--test", ...nodeTests]);
  if (code !== 0) process.exit(code);
}

if (vitestTests.length > 0) {
  const code = await run("CLI vitest tests", "pnpm", ["exec", "vitest", "run", ...vitestTests]);
  if (code !== 0) process.exit(code);
}
