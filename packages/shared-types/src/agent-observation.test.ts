import { describe, expect, it } from "vitest";

import { validateAgentObservation } from "./agent-observation.js";

describe("agent observation guard", () => {
  it("requires an agent to have read the entity before writing", () => {
    expect(
      validateAgentObservation({
        actorClientType: "agent",
        operation: "canvas update",
        currentVersion: "revision-2",
      }),
    ).toEqual({
      ok: false,
      code: "READ_REQUIRED",
      error: "READ_REQUIRED: Read the target before canvas update.",
    });

    expect(
      validateAgentObservation({
        actorClientType: "mcp",
        operation: "canvas update",
        currentVersion: "revision-2",
      }),
    ).toMatchObject({ ok: false, code: "READ_REQUIRED" });
  });

  it("rejects an agent write when the canonical version changed after the read", () => {
    expect(
      validateAgentObservation({
        actorClientType: "agent",
        operation: "timeline apply",
        observedVersion: "revision-1",
        currentVersion: "revision-2",
      }),
    ).toEqual({
      ok: false,
      code: "STALE_READ",
      error:
        "STALE_READ: The target changed after it was read. Read it again before timeline apply.",
    });
  });

  it("accepts matching agent versions and does not impose agent state on human writes", () => {
    expect(
      validateAgentObservation({
        actorClientType: "agent",
        operation: "text apply",
        observedVersion: "revision-2",
        currentVersion: "revision-2",
      }),
    ).toEqual({ ok: true });

    expect(
      validateAgentObservation({
        actorClientType: "cli",
        operation: "text apply",
        currentVersion: "revision-2",
      }),
    ).toEqual({ ok: true });
  });
});
