import { describe, expect, it } from "vitest";

import { resolveProjectShareAdmission } from "./projectShareGate";

describe("resolveProjectShareAdmission", () => {
  it("lets project status action gates override runtime sharing capability", () => {
    expect(resolveProjectShareAdmission({
      shareGate: {
        allowed: false,
        reason: "project-is-local-only",
        requirements: ["enable-sync"],
      },
      runtimePersistence: "remote",
    })).toEqual({
      visible: true,
      allowed: false,
      tooltip: "Enable sync before sharing this project",
      source: "project-status",
    });
  });

  it("falls back to runtime capability only when project status is unavailable", () => {
    expect(resolveProjectShareAdmission({
      shareGate: null,
      runtimePersistence: "remote",
    })).toEqual({
      visible: true,
      allowed: true,
      tooltip: "Copy project link",
      source: "runtime-capability-fallback",
    });

    expect(resolveProjectShareAdmission({
      shareGate: null,
      runtimePersistence: "local",
    })).toEqual({
      visible: false,
      allowed: false,
      tooltip: "Copy project link",
      source: "runtime-capability-fallback",
    });
  });

  it("surfaces missing mirror requirements for pending cloud-sync projects", () => {
    expect(resolveProjectShareAdmission({
      shareGate: {
        allowed: false,
        reason: "cloud-sync-not-ready",
        requirements: ["canvas", "room", "asset-metadata", "revision-content"],
      },
      runtimePersistence: "remote",
    })).toEqual({
      visible: true,
      allowed: false,
      tooltip: "Finish cloud sync setup before sharing: canvas, room, asset metadata, revision content",
      source: "project-status",
    });
  });
});
