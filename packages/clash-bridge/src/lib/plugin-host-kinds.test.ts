import { describe, expect, it } from "vitest";

import { PLUGIN_FUNCTION_KINDS } from "./plugin-host-ipc";

/**
 * The IPC layer must accept every plugin function kind the schema defines.
 *
 * `provider-executor` -- the kind that actually runs a generation -- was missing from the `resolve`
 * validation while the shared schema listed it in four places, so every generation through a plugin
 * provider died with a message about its own protocol:
 *
 *   Invalid plugin function kind.
 *
 * The gap was invisible because a previous host bundle is emitted into this package's `dist` and did
 * handle the kind; source and artefact disagreed, and the artefact was the one running.
 */
describe("plugin function kinds", () => {
  it("includes the kind that executes generations", () => {
    expect(PLUGIN_FUNCTION_KINDS).toContain("provider-executor");
  });

  it("matches the kinds the shared schema declares", () => {
    expect([...PLUGIN_FUNCTION_KINDS].sort())
      .toEqual(["action", "provider-executor", "provider-projector"]);
  });
});
