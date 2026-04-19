import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsset, invalidateAsset, getAsset } from "./useAsset";
import type { Asset } from "@clash/shared-types";

function makeAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    userId: "user-1",
    kind: "image",
    srcR2Key: "uploads/x.png",
    coverR2Key: null,
    width: null, height: null, durationMs: null, bytes: null,
    sourceModel: null, sourcePrompt: null, sourceTaskId: null,
    createdAt: 1, updatedAt: 1,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("useAsset", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Wipe module-level cache between tests by invalidating known IDs we touch.
    invalidateAsset("asset-1");
    invalidateAsset("asset-2");
    invalidateAsset("asset-3");
    invalidateAsset("asset-cover");
    invalidateAsset("asset-error");
  });

  it("returns undefined immediately when assetId is undefined", () => {
    const { result } = renderHook(() => useAsset(undefined));
    expect(result.current).toBeUndefined();
  });

  it("fetches and resolves a fresh asset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(makeAsset()));

    const { result } = renderHook(() => useAsset("asset-1"));
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current?.id).toBe("asset-1"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/assets/asset-1");
  });

  it("URL-encodes the asset id (handles slashes/colons)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(makeAsset({ id: "weird/id:1" })));
    renderHook(() => useAsset("weird/id:1"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/assets/weird%2Fid%3A1");
  });

  it("dedupes concurrent requests for the same id (one network call)", async () => {
    let resolveFetch: (r: Response) => void;
    const promise = new Promise<Response>((res) => { resolveFetch = res; });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(promise);

    const r1 = renderHook(() => useAsset("asset-2"));
    const r2 = renderHook(() => useAsset("asset-2"));
    const r3 = renderHook(() => useAsset("asset-2"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);

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

  it("serves subsequent reads from cache (no second fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(makeAsset({ id: "asset-3" })));

    const r1 = renderHook(() => useAsset("asset-3"));
    await waitFor(() => expect(r1.result.current?.id).toBe("asset-3"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // New mount → cache hit, no extra fetch
    const r2 = renderHook(() => useAsset("asset-3"));
    await waitFor(() => expect(r2.result.current?.id).toBe("asset-3"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("invalidateAsset forces a re-fetch on next read", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeAsset({ id: "asset-cover", coverR2Key: null })))
      .mockResolvedValueOnce(jsonResponse(makeAsset({ id: "asset-cover", coverR2Key: "covers/new.jpg" })));

    const r1 = renderHook(() => useAsset("asset-cover"));
    await waitFor(() => expect(r1.result.current?.coverR2Key).toBeNull());

    invalidateAsset("asset-cover");

    const r2 = renderHook(() => useAsset("asset-cover"));
    await waitFor(() => expect(r2.result.current?.coverR2Key).toBe("covers/new.jpg"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns undefined when the fetch fails (does not throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    const { result } = renderHook(() => useAsset("asset-error"));
    // Allow the effect+catch to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeUndefined();
  });

  it("getAsset (imperative) returns the same cached value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(makeAsset({ id: "asset-1" })));

    const a = await getAsset("asset-1");
    expect(a.id).toBe("asset-1");

    // Second call hits cache (no new fetch, but should still resolve identically)
    const b = await getAsset("asset-1");
    expect(b).toEqual(a);
  });
});
