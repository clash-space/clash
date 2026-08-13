import { afterEach, describe, expect, it, vi } from "vitest";
import { applyImageEdit, applyVideoCrop } from "./editPipeline";

class LoadedImage {
  naturalWidth = 4;
  naturalHeight = 3;
  crossOrigin = "";
  onload?: () => void;
  onerror?: (error: unknown) => void;

  set src(_value: string) {
    this.onload?.();
  }
}

describe("editPipeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes time-range edits through the server and marks preview edits implicit", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "edited-video",
            kind: "video",
            metadata: {},
            lifecycle: { state: "active" },
            status: "ready",
            url: "https://assets.example/edited-video.mp4",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await applyVideoCrop({
      actionRunId: "edit:crop-route-1",
      projectId: "project-1",
      sourceAssetId: "source-video",
      params: { mode: "crop", startSec: 1, endSec: 4 },
      origin: "asset-preview",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/edits/video-crop",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const request = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      actionRunId: "edit:crop-route-1",
      projectId: "project-1",
      sourceAssetId: "source-video",
      params: { mode: "crop", startSec: 1, endSec: 4 },
      origin: "asset-preview",
      invocation: {
        actionId: "video-clipper",
        projectId: "project-1",
        source: { assetId: "source-video", kind: "video" },
        params: { mode: "crop", startSec: 1, endSec: 4 },
        surface: "asset-preview",
        mode: "implicit",
      },
    });
  });

  it("rejects a successful HTTP response that is not a ResolvedAsset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "edited-video" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      applyVideoCrop({
        actionRunId: "edit:invalid-response-1",
        projectId: "project-1",
        sourceAssetId: "source-video",
        params: { mode: "crop", startSec: 1, endSec: 4 },
      }),
    ).rejects.toThrow();
  });

  it("reuses the logical invocation actionRunId after an unknown crop result", async () => {
    let attempt = 0;
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        attempt += 1;
        if (attempt === 1) throw new TypeError("connection closed");
        return new Response(
          JSON.stringify({
            id: "edited-video",
            kind: "video",
            metadata: {},
            lifecycle: { state: "active" },
            status: "ready",
            url: "https://assets.example/edited-video.mp4",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const logicalInvocation = {
      projectId: "project-1",
      sourceAssetId: "source-video",
      params: { mode: "crop" as const, startSec: 1, endSec: 4 },
    };

    await expect(applyVideoCrop(logicalInvocation)).rejects.toThrow(
      "connection closed",
    );
    await expect(applyVideoCrop(logicalInvocation)).resolves.toEqual({
      assetId: "edited-video",
    });
    expect(requests[0]?.actionRunId).toMatch(/^edit:/);
    expect(requests[1]?.actionRunId).toBe(requests[0]?.actionRunId);
  });

  it("includes the caller-owned actionRunId in client-rendered edit publication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body as FormData;
        expect(form.get("actionRunId")).toBe("edit:client-render-1");
        return new Response(
          JSON.stringify({
            id: "edited-image",
            kind: "image",
            metadata: {},
            lifecycle: { state: "active" },
            status: "ready",
            url: "https://assets.example/edited-image.png",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const context = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    };
    const canvases: Array<{
      width: number;
      height: number;
      getContext: () => typeof context;
      toBlob: (callback: (blob: Blob) => void) => void;
    }> = [];
    vi.stubGlobal("Image", LoadedImage);
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`Unexpected element ${tag}`);
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob: (callback: (blob: Blob) => void) =>
            callback(new Blob(["edited"], { type: "image/png" })),
        };
        canvases.push(canvas);
        return canvas;
      },
    });

    await expect(
      applyImageEdit({
        actionRunId: "edit:client-render-1",
        projectId: "project-1",
        sourceAssetId: "source-image",
        sourceUrl: "https://assets.example/source.png",
        params: { rotation: 90 },
      }),
    ).resolves.toEqual({ assetId: "edited-image" });
    expect(canvases).toHaveLength(2);
  });

  it("reuses the logical client-render invocation actionRunId after an unknown result", async () => {
    const actionRunIds: unknown[] = [];
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        actionRunIds.push((init?.body as FormData).get("actionRunId"));
        attempt += 1;
        if (attempt === 1) throw new TypeError("connection closed");
        return new Response(
          JSON.stringify({
            id: "edited-image",
            kind: "image",
            metadata: {},
            lifecycle: { state: "active" },
            status: "ready",
            url: "https://assets.example/edited-image.png",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const context = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    };
    vi.stubGlobal("Image", LoadedImage);
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`Unexpected element ${tag}`);
        return {
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob: (callback: (blob: Blob) => void) =>
            callback(new Blob(["edited"], { type: "image/png" })),
        };
      },
    });
    const logicalInvocation = {
      projectId: "project-1",
      sourceAssetId: "source-image",
      sourceUrl: "https://assets.example/source.png",
      params: { rotation: 90 as const },
    };

    await expect(applyImageEdit(logicalInvocation)).rejects.toThrow(
      "connection closed",
    );
    await expect(applyImageEdit(logicalInvocation)).resolves.toEqual({
      assetId: "edited-image",
    });
    expect(actionRunIds[0]).toMatch(/^edit:/);
    expect(actionRunIds[1]).toBe(actionRunIds[0]);
  });
});
