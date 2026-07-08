// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useProjectStatus } from "./useProjectStatus";

describe("useProjectStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  it("loads project collaboration action gates from the local status endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/projects/project-1/status");
      expect(init?.credentials).toBe("same-origin");
      return new Response(JSON.stringify({
        projectId: "project-1",
        source: "explicit",
        mode: "local-only",
        syncMode: "local-only",
        collaboration: {
          schemaVersion: 1,
          mode: "local-only",
          rawMode: "local-only",
          webOpenable: false,
          multiUser: false,
          roomAuthority: "local",
          cloudProjectRoom: "disabled",
          syncReadiness: {
            status: "disabled",
            ready: false,
            required: ["canvas", "room", "asset-metadata"],
            missing: ["canvas", "room", "asset-metadata"],
          },
          actions: {
            openInWeb: {
              allowed: false,
              reason: "project-is-local-only",
              requirements: ["enable-sync"],
            },
            enableSync: {
              allowed: true,
              reason: null,
              requirements: [],
            },
            shareProject: {
              allowed: false,
              reason: "project-is-local-only",
              requirements: ["enable-sync"],
            },
            runLocalAgent: {
              allowed: true,
              reason: null,
              requirements: ["owner-machine-online"],
            },
          },
          localAgentRuntime: {
            requiredForLocalActions: true,
            availability: "owner-machine-online",
          },
        },
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectStatus("project-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.status?.projectId).toBe("project-1"));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.actions?.openInWeb).toEqual({
      allowed: false,
      reason: "project-is-local-only",
      requirements: ["enable-sync"],
    });
    expect(result.current.actions?.enableSync.allowed).toBe(true);
    expect(result.current.actions?.runLocalAgent.requirements).toEqual(["owner-machine-online"]);
  });

  it("does not fetch without a project id", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectStatus(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
    expect(result.current.actions).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
