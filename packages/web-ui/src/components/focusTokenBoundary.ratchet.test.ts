import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd());
const productionRoots = [
  "apps/web/app",
  "packages/gui/src",
  "packages/remotion-ui/src",
  "packages/web-ui/src",
];

function listProductionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listProductionSources(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:test|stories)\.[^.]+$/.test(entry.name)) return [];
    return [path];
  });
}

describe("focus token boundary", () => {
  it("keeps ordinary focus borders and rings on the semantic focus token", () => {
    const violations = productionRoots.flatMap((root) =>
      listProductionSources(resolve(repositoryRoot, root)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const matches = source.match(
          /(?:group-)?focus(?:-visible)?:(?:ring|border)-brand(?:\/[\d.]+)?/g,
        );
        return (matches ?? []).map(
          (match) => `${path.slice(repositoryRoot.length + 1)}: ${match}`,
        );
      }),
    );

    expect(violations).toEqual([]);
  });
});
