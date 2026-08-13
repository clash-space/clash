import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

type WorkspacePackage = {
  directory: string;
  manifest: {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
};

function collectWorkspacePackages(directory: string): WorkspacePackage[] {
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) return [];
    const path = resolve(directory, entry);
    if (!statSync(path).isDirectory()) return [];
    const manifestPath = resolve(path, "package.json");
    if (existsSync(manifestPath)) {
      return [{
        directory: path,
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as WorkspacePackage["manifest"],
      }];
    }
    return collectWorkspacePackages(path);
  });
}

function collectTypeScriptSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) return [];
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return collectTypeScriptSources(path);
    return /\.(?:cts|mts|mjs|ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const workspacePackages = ["apps", "packages", "plugins"]
  .flatMap((directory) => collectWorkspacePackages(resolve(repoRoot, directory)));

// Repository-wide filesystem walks can overlap with package tests and type-checkers in CI.
const REPOSITORY_SCAN_TIMEOUT_MS = 30_000;

describe("repository conventions", () => {
  it("keeps source files in TypeScript, not JavaScript", () => {
    expect(collectJavaScriptSourceFiles(repoRoot)).toEqual([]);
  }, REPOSITORY_SCAN_TIMEOUT_MS);

  it("declares every directly imported workspace package", () => {
    const workspaceNames = new Set(workspacePackages.map(({ manifest }) => manifest.name));
    const missing = workspacePackages.flatMap(({ directory, manifest }) => {
      const declared = new Set(Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      }));
      return collectTypeScriptSources(directory).flatMap((sourcePath) => {
        const source = readFileSync(sourcePath, "utf8");
        const packageImports = source.matchAll(
          /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](@clash(?:-plugin)?\/[A-Za-z0-9._-]+|clash)(?:\/[^"']+)?["']/g,
        );
        const missingPackageImports = [...packageImports].flatMap((match) => {
          const dependency = match[1];
          if (dependency === manifest.name || !workspaceNames.has(dependency) || declared.has(dependency)) {
            return [];
          }
          return [{
            package: manifest.name,
            file: relative(repoRoot, sourcePath),
            dependency,
          }];
        });
        const relativeImports = source.matchAll(
          /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']((?:\.\.\/)+[^"']+)["']/g,
        );
        const missingRelativeImports = [...relativeImports].flatMap((match) => {
          const target = resolve(dirname(sourcePath), match[1]);
          const owner = workspacePackages.find(({ directory: candidate }) =>
            target === candidate || target.startsWith(`${candidate}/`),
          );
          if (!owner || owner.manifest.name === manifest.name || declared.has(owner.manifest.name)) {
            return [];
          }
          return [{
            package: manifest.name,
            file: relative(repoRoot, sourcePath),
            dependency: owner.manifest.name,
          }];
        });
        return [...missingPackageImports, ...missingRelativeImports];
      });
    });

    expect(missing).toEqual([]);
  }, REPOSITORY_SCAN_TIMEOUT_MS);

  it("keeps cross-workspace orchestration in the root package", () => {
    const crossWorkspaceScripts = workspacePackages.flatMap(({ manifest }) =>
      Object.entries(manifest.scripts ?? {}).flatMap(([name, command]) =>
        /(?:npm\s+--prefix|pnpm\s+--(?:dir|filter)|turbo\s+run)/.test(command)
          ? [{ package: manifest.name, script: name, command }]
          : [],
      ),
    );

    expect(crossWorkspaceScripts).toEqual([]);
  });
});
