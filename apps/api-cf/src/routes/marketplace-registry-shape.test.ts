import { describe, expect, it } from "vitest";

import firstPartyRegistry from "../../../../skills/registry.json";

/**
 * The route must not spread a registry key that no longer exists.
 *
 * `registry.json` lost its `actions` array when the skill marketplace was retired, but the route kept
 * doing `[...FIRST_PARTY.actions]`, so every marketplace request threw:
 *
 *   TypeError: FIRST_PARTY.actions is not iterable
 *
 * The endpoint returned 500 and three tests had been failing for long enough to be treated as
 * background noise. A typed import would have caught it; `as RegistryData` asserted the old shape over
 * the new file and silenced the one check that mattered.
 */
describe("first-party registry shape", () => {
  const registry = firstPartyRegistry as Record<string, unknown>;

  it("has the keys the route reads", () => {
    expect(Array.isArray(registry.skills)).toBe(true);
    expect(typeof registry.version).toBe("number");
  });

  it("no longer carries an actions array", () => {
    // Retired with the skill marketplace. Asserted so the route is never written against it again.
    expect(registry.actions).toBeUndefined();
  });
});
