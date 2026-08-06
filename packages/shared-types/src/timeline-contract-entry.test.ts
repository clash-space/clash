import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Timeline contract package boundary", () => {
  it("publishes a narrow side-effect-free Timeline contract subpath", () => {
    const packageJson = JSON.parse(readFileSync(
      resolve(process.cwd(), "package.json"),
      "utf8",
    )) as {
      exports: Record<string, unknown>;
      scripts: { build: string };
    };

    expect(packageJson.exports["./timeline-contract"]).toEqual({
      types: "./dist/timeline-contract.d.ts",
      import: "./dist/timeline-contract.js",
      default: "./dist/timeline-contract.js",
    });
    expect(packageJson.scripts.build).toContain("src/timeline-contract.ts");
  });
});
