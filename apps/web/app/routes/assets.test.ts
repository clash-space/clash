import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "./assets";

afterEach(() => vi.restoreAllMocks());

describe("Global Assets route", () => {
  it("loads active and trashed entries through the canonical personal-library endpoint", async () => {
    const assets = [
      {
        id: "global:active",
        kind: "image",
        lifecycle: { state: "active" },
        metadata: {},
        status: "unavailable",
      },
      {
        id: "global:trashed",
        kind: "video",
        lifecycle: {
          state: "trashed",
          deleteOperationId: "delete-1",
          deletedAt: "2026-08-13T00:00:00.000Z",
          purgeAfter: "2026-09-12T00:00:00.000Z",
        },
        metadata: {},
        status: "unavailable",
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ assets }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loader()).resolves.toEqual({ assets });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/libraries/personal/assets",
      { credentials: "include", headers: {}, method: "GET" },
    );
  });

  it("fails closed when a Host omits the logical lifecycle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          assets: [
            {
              id: "global:ambiguous",
              kind: "image",
              metadata: {},
              status: "unavailable",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(loader()).rejects.toThrow();
  });
});
