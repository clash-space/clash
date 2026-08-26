import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "./marketplace.manage";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Marketplace manage loader", () => {
  it("renders an empty marketplace when local installed-item reads time out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException(
          "signal is aborted without reason",
          "AbortError",
        );
      }),
    );

    await expect(loader()).resolves.toEqual({
      items: [],
      installedActionIds: [],
      installedSkillIds: [],
    });
  });

  it("keeps registry and healthy install state when one installed source is malformed", async () => {
    const registryItem = {
      id: "codex-imagegen",
      name: "Codex ImageGen",
      type: "action",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/marketplace/registry") {
          return Response.json({
            version: 1,
            actions: [registryItem],
            skills: [],
          });
        }
        if (path === "/api/settings/actions") {
          return Response.json([{ actionId: "codex-imagegen" }]);
        }
        return Response.json({ error: "bad local skill state" });
      }),
    );

    await expect(loader()).resolves.toEqual({
      items: [registryItem],
      installedActionIds: ["codex-imagegen"],
      installedSkillIds: [],
    });
  });

  it("finishes after the local timeout when one installed source never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/settings/skills") {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
        return Response.json(
          path === "/api/marketplace/registry"
            ? { version: 1, actions: [], skills: [] }
            : [],
        );
      }),
    );

    const result = loader();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual({
      items: [],
      installedActionIds: [],
      installedSkillIds: [],
    });
  });

  it("degrades a malformed registry payload instead of failing the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        return Response.json(
          path === "/api/marketplace/registry"
            ? { version: 1, actions: null, skills: { bad: true } }
            : [],
        );
      }),
    );

    await expect(loader()).resolves.toEqual({
      items: [],
      installedActionIds: [],
      installedSkillIds: [],
    });
  });

  it("preserves authentication redirects from installed-item sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://clash.local").pathname;
        if (path === "/api/settings/skills") {
          return new Response(null, { status: 401 });
        }
        return Response.json(
          path === "/api/marketplace/registry"
            ? { version: 1, actions: [], skills: [] }
            : [],
        );
      }),
    );

    await expect(loader()).rejects.toMatchObject({ status: 302 });
  });
});
