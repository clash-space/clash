import { describe, expect, it } from "vitest";

import { validateAgentObservation } from "./agent-observation.js";

/**
 * Concurrency evidence is not a permission, so it cannot be waived by the label
 * a client puts on itself. A `cli`-tagged writer racing an `agent`-tagged writer
 * corrupts the same state either way.
 */
describe("agent observation validation", () => {
  it("rejects a stale write regardless of the client label", () => {
    for (const actorClientType of ["agent", "cli", undefined]) {
      const result = validateAgentObservation({
        actorClientType,
        operation: "canvas update",
        observedVersion: "v1",
        currentVersion: "v2",
      });
      expect(result.ok, `client ${String(actorClientType)} must not bypass CAS`).toBe(false);
      expect(result.ok ? "" : result.code).toBe("STALE_READ");
    }
  });

  it("accepts a write that names the current version", () => {
    for (const actorClientType of ["agent", "cli", undefined]) {
      expect(
        validateAgentObservation({
          actorClientType,
          operation: "canvas update",
          observedVersion: "v2",
          currentVersion: "v2",
        }).ok,
      ).toBe(true);
    }
  });

  it("still requires proof of read for agents", () => {
    const result = validateAgentObservation({
      actorClientType: "agent",
      operation: "canvas update",
      currentVersion: "v2",
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("READ_REQUIRED");
  });
});
