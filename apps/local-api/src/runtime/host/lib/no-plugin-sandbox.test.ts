import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "actions-loader.ts"), "utf8");

/**
 * Plugins run as ordinary processes.
 *
 * Node's permission model was applied to every plugin, which broke the first-party one outright: a
 * bundle that imports `@clash/shared-types` reads from `packages/shared-types/dist`, outside the
 * plugin directory, and Node answers `ERR_ACCESS_DENIED` before the plugin prints anything. The
 * failure surfaced as "closed its stdio channel", which names neither the file nor the flag.
 *
 * The sandbox was also not the boundary that mattered. Credentials never reach the process
 * environment; account state and assets remain Host-scoped. `--permission` sat on top of those
 * boundaries and mostly kept honest plugins from loading their own dependencies.
 *
 * The trade is stated rather than hidden: a plugin can read the filesystem of the account that
 * installed it. Installing one is the decision.
 */
describe("plugins are not sandboxed", () => {
  it("spawns without Node's permission model", () => {
    expect(source).not.toMatch(/"--permission"/);
    expect(source).not.toMatch(/--allow-fs-read/);
  });
});
