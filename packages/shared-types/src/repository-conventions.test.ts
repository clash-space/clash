import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function findRepoRoot(startDirectory: string): string {
  let directory = resolve(startDirectory);

  while (!existsSync(`${directory}/pnpm-workspace.yaml`)) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find repository root");
    }
    directory = parent;
  }

  return directory;
}

const repoRoot = findRepoRoot(process.cwd());

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".remotion-bundle",
  ".tmp",
  ".turbo",
  ".vercel",
  ".venv",
  ".vitepress",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release",
  // Installable plugins commit their built MCP/App artifacts for Codex to launch.
  "runtime",
]);

function collectJavaScriptSourceFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      if (ignoredDirectories.has(entry)) return [];

      const path = `${directory}/${entry}`;
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return collectJavaScriptSourceFiles(path);
      }

      if (entry.endsWith(".js") || entry.endsWith(".jsx")) {
        return [relative(repoRoot, path)];
      }

      return [];
    })
    .sort();
}

describe("repository conventions", () => {
  it("keeps source files in TypeScript, not JavaScript", () => {
    expect(collectJavaScriptSourceFiles(repoRoot)).toEqual([]);
  });
});
