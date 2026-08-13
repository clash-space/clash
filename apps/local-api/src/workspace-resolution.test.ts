import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

/**
 * Bundled plugins must be resolvable the way the host resolves them.
 *
 * `ensureBundledPlugin` finds each plugin with `require.resolve`, which is Node's own resolution --
 * not Vite's. That matters because `@clash/shared-types` declares a `development` export condition
 * pointing at `src/index.ts`, and that file imports its 52 siblings with `.js` specifiers. Vite
 * rewrites those to `.ts`; Node does not, so anything reaching the package through native
 * resolution dies on the first sibling it evaluates -- which is how a seeding test came to fail
 * with "Cannot find module .../timeline-field-annotations.js" about a file that was present.
 *
 * This pins the contract the host actually depends on: each bundled plugin resolves to a built
 * artefact, with no TypeScript in the path.
 */
const PLUGINS = [
  "@clash-plugin/google",
  "@clash-plugin/minimax",
  "@clash-plugin/pika",
  "@clash-plugin/volcengine",
  "@clash-plugin/codex-imagegen",
];

describe("bundled plugin resolution", () => {
  const require = createRequire(import.meta.url);

  it("resolves every bundled plugin's manifest and entrypoint", () => {
    for (const name of PLUGINS) {
      expect(
        () => require.resolve(`${name}/manifest.json`),
        name,
      ).not.toThrow();
      expect(() => require.resolve(`${name}/stdio`), name).not.toThrow();
    }
  });

  it("points each entrypoint at a built bundle, not at TypeScript", () => {
    // A plugin entrypoint that resolved to `.ts` would run under the host's Node with no
    // transform in front of it.
    for (const name of PLUGINS) {
      expect(require.resolve(`${name}/stdio`), name).toMatch(/\.(mjs|js|cjs)$/);
    }
  });

  it("loads a bundled entrypoint under plain Node resolution", async () => {
    // The check that would have caught this directly: import it the way the host's subprocess
    // does, with no bundler in the way.
    await expect(
      import(require.resolve("@clash-plugin/google/stdio")),
    ).resolves.toBeTruthy();
    await expect(
      import(require.resolve("@clash-plugin/pika/stdio")),
    ).resolves.toBeTruthy();
  });
});
