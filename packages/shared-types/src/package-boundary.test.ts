import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, string | Record<string, string>>;
}

function readPackage(relativePath: string): PackageJson {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as PackageJson;
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
      readPackage("../package.json"),
      readPackage("../../shared-layout/package.json"),
    ];

    for (const pkg of packages) {
      expect(runtimeExportTargets(pkg).filter((target) => target.endsWith(".ts"))).toEqual([]);
    }
  });
});
