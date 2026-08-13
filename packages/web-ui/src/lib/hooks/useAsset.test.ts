// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import {
  admitPersonalGlobalAssetToProject,
  getAsset,
  importPersonalGlobalAssetFile,
  importProjectAssetFile,
  invalidateAsset,
  listPersonalGlobalAssets,
  publishProjectAssetToPersonalLibrary,
  restoreProjectAsset,
  trashProjectAsset,
  useAsset,
} from "./useAsset";
import type { ResolvedAsset } from "@clash/shared-types";

function makeAsset(over: Partial<ResolvedAsset> = {}): ResolvedAsset {
  return {
    id: "asset-1",
    kind: "image",
    name: "Source image",
    metadata: { width: 1024, height: 768, contentType: "image/png" },
    lifecycle: { state: "active" },
    status: "ready",
    url: "https://media.clash.test/assets/asset-1",
    thumbnailUrl: "https://media.clash.test/thumbnails/asset-1",
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-clash-read-receipt": "browser-read-receipt",
    },
  });
}

describe("useAsset", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
    // Wipe module-level cache between tests by invalidating known IDs we touch.
    invalidateAsset("project-1", "asset-1");
    invalidateAsset("project-1", "asset-2");
    invalidateAsset("project-1", "asset-3");
    invalidateAsset("project-1", "asset-cover");
    invalidateAsset("project-1", "asset-error");
    invalidateAsset("project-1", "asset-admitted");
    invalidateAsset("project-2", "asset-1");
  });

  it("returns undefined immediately when assetId is undefined", () => {
    const { result } = renderHook(() => useAsset("project-1", undefined));
    expect(result.current).toBeUndefined();
  });

  it("fetches and resolves a fresh asset", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(makeAsset()));

    const { result } = renderHook(() => useAsset("project-1", "asset-1"));
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current?.id).toBe("asset-1"));
    // fetchWithRetry passes a second arg with the (possibly undefined) signal; match loosely.
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/v1/projects/project-1/assets/asset-1",
    );
  });

  it("URL-encodes the asset id (handles slashes/colons)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(makeAsset({ id: "weird/id:1" })));
    renderHook(() => useAsset("project/one", "weird/id:1"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/v1/projects/project%2Fone/assets/weird%2Fid%3A1",
    );
  });

  it("uses the injected runtime API base URL", async () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      apiBaseUrl: "http://127.0.0.1:49152",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(makeAsset({ id: "asset-runtime" })));

    renderHook(() => useAsset("project-1", "asset-runtime"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://127.0.0.1:49152/api/v1/projects/project-1/assets/asset-runtime",
    );
  });

  it("dedupes concurrent requests for the same id (one network call)", async () => {
    let resolveFetch: (r: Response) => void;
    const promise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(promise);

    const r1 = renderHook(() => useAsset("project-1", "asset-2"));
    const r2 = renderHook(() => useAsset("project-1", "asset-2"));
    const r3 = renderHook(() => useAsset("project-1", "asset-2"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/v1/projects/project-1/assets/asset-2",
    );

    await act(async () => {
      resolveFetch!(jsonResponse(makeAsset({ id: "asset-2" })));
      await promise;
    });

    await waitFor(() => {
      expect(r1.result.current?.id).toBe("asset-2");
      expect(r2.result.current?.id).toBe("asset-2");
      expect(r3.result.current?.id).toBe("asset-2");
    });
  });

  it("batches concurrent requests for different ids", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        assets: [makeAsset({ id: "asset-1" }), makeAsset({ id: "asset-2" })],
      }),
    );

    const r1 = renderHook(() => useAsset("project-1", "asset-1"));
    const r2 = renderHook(() => useAsset("project-1", "asset-2"));

    await waitFor(() => {
      expect(r1.result.current?.id).toBe("asset-1");
      expect(r2.result.current?.id).toBe("asset-2");
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/v1/projects/project-1/assets/batch",
    );
    expect(
      JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      ids: ["asset-1", "asset-2"],
    });
  });

  it("serves subsequent reads from cache (no second fetch)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(makeAsset({ id: "asset-3" })));

    const r1 = renderHook(() => useAsset("project-1", "asset-3"));
    await waitFor(() => expect(r1.result.current?.id).toBe("asset-3"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // New mount → cache hit, no extra fetch
    const r2 = renderHook(() => useAsset("project-1", "asset-3"));
    await waitFor(() => expect(r2.result.current?.id).toBe("asset-3"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("invalidateAsset forces a re-fetch on next read", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(makeAsset({ id: "asset-cover", thumbnailUrl: undefined })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makeAsset({
            id: "asset-cover",
            thumbnailUrl: "https://media.clash.test/thumbnails/asset-cover",
          }),
        ),
      );

    const r1 = renderHook(() => useAsset("project-1", "asset-cover"));
    await waitFor(() =>
      expect(r1.result.current?.thumbnailUrl).toBeUndefined(),
    );

    invalidateAsset("project-1", "asset-cover");

    const r2 = renderHook(() => useAsset("project-1", "asset-cover"));
    await waitFor(() =>
      expect(r2.result.current?.thumbnailUrl).toBe(
        "https://media.clash.test/thumbnails/asset-cover",
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns undefined when the fetch fails (does not throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 500 }),
    );

    const { result } = renderHook(() => useAsset("project-1", "asset-error"));
    // Allow the effect+catch to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeUndefined();
  });

  it("getAsset (imperative) returns the same cached value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeAsset({ id: "asset-1" })),
    );

    const a = await getAsset("project-1", "asset-1");
    expect(a.id).toBe("asset-1");

    // Second call hits cache (no new fetch, but should still resolve identically)
    const b = await getAsset("project-1", "asset-1");
    expect(b).toEqual(a);
  });

  it("does not share a cached asset across project scopes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(makeAsset({ name: "Project one asset" })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makeAsset({ name: "Project two asset" })),
      );

    await expect(getAsset("project-1", "asset-1")).resolves.toMatchObject({
      name: "Project one asset",
    });
    await expect(getAsset("project-2", "asset-1")).resolves.toMatchObject({
      name: "Project two asset",
    });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/projects/project-1/assets/asset-1",
      "/api/v1/projects/project-2/assets/asset-1",
    ]);
  });

  it("imports bytes through the Project-scoped Host endpoint and caches the returned projection", async () => {
    const imported = makeAsset({
      id: "asset-imported",
      name: "opening.png",
      url: "https://media.clash.test/api/v1/projects/project-1/assets/asset-imported/media",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(imported));
    const file = new File(["png bytes"], "opening.png", { type: "image/png" });

    await expect(
      importProjectAssetFile("project-1", file, {
        kind: "image",
        projectAssetId: "asset-imported",
      }),
    ).resolves.toEqual(imported);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/projects/project-1/assets/import-file");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("kind")).toBe("image");
    expect(form.get("projectAssetId")).toBe("asset-imported");

    await expect(getAsset("project-1", "asset-imported")).resolves.toEqual(
      imported,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("admits a personal Global Asset through the Project transport and caches it", async () => {
    const admitted = makeAsset({ id: "asset-admitted" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(admitted, 201));

    await expect(
      admitPersonalGlobalAssetToProject("project-1", "global:one"),
    ).resolves.toEqual(admitted);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/project-1/assets/admit",
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ globalAssetId: "global:one" }),
    });
    await expect(getAsset("project-1", "asset-admitted")).resolves.toEqual(
      admitted,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the personal Global client for list, import, and publish", async () => {
    const globalAsset = makeAsset({ id: "global:one" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ assets: [globalAsset] }))
      .mockResolvedValueOnce(jsonResponse(globalAsset, 201))
      .mockResolvedValueOnce(jsonResponse(globalAsset, 201));
    const file = new File(["png bytes"], "library.png", {
      type: "image/png",
    });

    await expect(listPersonalGlobalAssets()).resolves.toEqual([globalAsset]);
    await expect(importPersonalGlobalAssetFile(file, "image")).resolves.toEqual(
      globalAsset,
    );
    await expect(
      publishProjectAssetToPersonalLibrary("project-1", "asset-1"),
    ).resolves.toEqual(globalAsset);

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/libraries/personal/assets",
      "/api/v1/libraries/personal/assets/import-file",
      "/api/v1/libraries/personal/assets/publish",
    ]);
    const importForm = fetchSpy.mock.calls[1]?.[1]?.body as FormData;
    expect(importForm.get("file")).toBe(file);
    expect(importForm.get("kind")).toBe("image");
    expect(fetchSpy.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    });
  });

  it("uses the observed Project revision for logical trash and restore", async () => {
    const trashed = makeAsset({
      lifecycle: {
        state: "trashed",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-09-12T00:00:00.000Z",
      },
      status: "unavailable",
      url: undefined,
      thumbnailUrl: undefined,
    });
    const restored = makeAsset();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeAsset()))
      .mockResolvedValueOnce(jsonResponse(trashed))
      .mockResolvedValueOnce(jsonResponse(trashed))
      .mockResolvedValueOnce(jsonResponse(restored));

    await expect(trashProjectAsset("project-1", "asset-1")).resolves.toEqual(
      trashed,
    );
    await expect(
      restoreProjectAsset("project-1", "asset-1"),
    ).resolves.toEqual(restored);

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/projects/project-1/assets/asset-1",
      "/api/v1/projects/project-1/assets/asset-1",
      "/api/v1/projects/project-1/assets/asset-1",
      "/api/v1/projects/project-1/assets/asset-1/restore",
    ]);
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      headers: expect.objectContaining({
        "x-clash-client-type": "gui",
        "x-clash-if-match": "browser-read-receipt",
      }),
    });
    expect(fetchSpy.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "x-clash-if-match": "browser-read-receipt",
      }),
    });
  });

  it("surfaces ASSET_IN_USE instead of hiding a downstream Action reference", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeAsset()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "ASSET_IN_USE",
            error: "Project Asset asset-1 is still referenced.",
            references: [
              {
                id: "binding-1",
                owner: { kind: "draft", actionId: "timeline:cut" },
                direction: "input",
                slot: "timeline:item:clip-1",
                projectAssetId: "asset-1",
              },
            ],
          },
          409,
        ),
      );

    await expect(
      trashProjectAsset("project-1", "asset-1"),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: "ASSET_IN_USE" }),
    });
  });
});
