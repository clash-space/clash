import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageJson {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, string | Record<string, string>>;
}

function findRepoRoot(startDirectory: string): string {
  let directory = resolve(startDirectory);

  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find repository root");
    }
    directory = parent;
  }

  return directory;
}

const repoRoot = findRepoRoot(process.cwd());

function readPackage(relativePath: string): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as PackageJson;
}

function runtimeExportTargets(pkg: PackageJson): string[] {
  const targets: string[] = [];
  if (pkg.main) targets.push(pkg.main);
  if (pkg.module) targets.push(pkg.module);
  for (const value of Object.values(pkg.exports ?? {})) {
    if (typeof value === "string") {
      targets.push(value);
      continue;
    }
    if (value.import) targets.push(value.import);
    if (value.default) targets.push(value.default);
  }
  return targets;
}

describe("package runtime boundaries", () => {
  it("does not expose TypeScript source files through runtime entrypoints", () => {
    const packages = [
      readPackage("packages/shared-types/package.json"),
      readPackage("packages/shared-layout/package.json"),
    ];

    for (const pkg of packages) {
      expect(runtimeExportTargets(pkg).filter((target) => target.endsWith(".ts"))).toEqual([]);
    }
  });
});
