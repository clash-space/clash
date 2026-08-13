import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A resolve condition only works if some package declares it.
 *
 * `packages/cli` and `packages/web-ui` ask vitest for a `development` condition so workspace
 * packages resolve to source -- otherwise a change to `shared-types` stays invisible until it is
 * rebuilt, and the failure names the assertion rather than the staleness. `authFormControls` sat at
 * "not a function" through two rebuild attempts for exactly that reason.
 *
 * The condition has to exist on the other side. It was briefly added to `shared-types`'s exports
 * and had to come out again: it pointed at `src/index.ts`, whose 52 sibling imports carry `.js`
 * specifiers that Vite rewrites and Node does not -- so anything reaching the package through
 * `require.resolve`, which is how the host finds its bundled plugins, died on the first sibling.
 *
 * So the two must agree, and the way they agree is an alias rather than a condition: an alias is
 * scoped to the test runner and cannot leak into how the host resolves anything.
 */
const read = (path: string) =>
  readFileSync(join(__dirname, "../../..", path), "utf8");

describe("development resolution", () => {
  it("asks for source through an alias rather than an export condition", () => {
    for (const pkg of ["packages/cli", "packages/web-ui"]) {
      const config = read(`${pkg}/vitest.config.ts`);
      const wantsCondition =
        /conditions\s*:\s*\[[^\]]*["']development["']/.test(config);
      const hasAlias = /alias\s*:/.test(config);
      expect(
        !wantsCondition || hasAlias,
        `${pkg} asks for a development condition that nothing declares, and has no alias instead`,
      ).toBe(true);
    }
  });

  it("keeps production package exports resolvable by plain Node", () => {
    // The regression this guards: a `development` condition here sends `require.resolve` into
    // TypeScript, and the host's bundled-plugin seeding uses `require.resolve`.
    for (const packagePath of [
      "packages/shared-types",
      "packages/action-sdk",
    ]) {
      const pkg = JSON.parse(read(`${packagePath}/package.json`)) as {
        exports: Record<string, Record<string, string>>;
      };
      expect(pkg.exports["."], packagePath).not.toHaveProperty("development");
      expect(pkg.exports["."].import, packagePath).toMatch(/^\.\/dist\//);
    }
  });
});
