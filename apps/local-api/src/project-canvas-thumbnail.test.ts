import type { CachedProjectCanvasPreview } from "./loro/file-replica-store";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectCanvasThumbnailCache,
  renderProjectCanvasThumbnail,
} from "./project-canvas-thumbnail";

function previewEntry(sourceVersion: string): CachedProjectCanvasPreview {
  return {
    sourceVersion,
    generatedAt: "2026-08-27T00:00:00.000Z",
    preview: {
      canvasId: "main",
      bounds: { x: 0, y: 0, width: 640, height: 360 },
      nodes: [
        {
          id: "hero",
          type: "image",
          x: 0,
          y: 0,
          width: 640,
          height: 360,
          assetId: "asset-hero",
        },
      ],
    },
  };
}

describe("ProjectCanvasThumbnailCache", () => {
  it("coalesces concurrent renders and reuses the persisted revision", async () => {
    const persisted = new Map<string, Uint8Array>();
    const store = {
      readCanvasThumbnail: vi.fn(
        async (projectId: string, sourceVersion: string) =>
          persisted.get(`${projectId}:${sourceVersion}`) ?? null,
      ),
      writeCanvasThumbnail: vi.fn(
        async (projectId: string, sourceVersion: string, bytes: Uint8Array) => {
          persisted.set(`${projectId}:${sourceVersion}`, bytes);
        },
      ),
    };
    let releaseRender!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const render = vi.fn(async () => {
      await renderGate;
      return new Uint8Array([82, 73, 70, 70]);
    });
    const cache = new ProjectCanvasThumbnailCache({ store, render });
    const entry = previewEntry("a".repeat(64));
    const input = {
      projectId: "project-1",
      entry,
      resolveMedia: vi.fn(async () => null),
    };

    const first = cache.get(input);
    const second = cache.get(input);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    releaseRender();

    await expect(first).resolves.toEqual(new Uint8Array([82, 73, 70, 70]));
    await expect(second).resolves.toEqual(new Uint8Array([82, 73, 70, 70]));
    expect(store.writeCanvasThumbnail).toHaveBeenCalledOnce();

    await expect(cache.get(input)).resolves.toEqual(
      new Uint8Array([82, 73, 70, 70]),
    );
    expect(render).toHaveBeenCalledOnce();
  });

  it("renders a new immutable artifact for a new Project revision", async () => {
    const store = {
      readCanvasThumbnail: vi.fn(async () => null),
      writeCanvasThumbnail: vi.fn(async () => undefined),
    };
    const render = vi.fn(
      async ({ entry }: { entry: CachedProjectCanvasPreview }) =>
        new TextEncoder().encode(entry.sourceVersion),
    );
    const cache = new ProjectCanvasThumbnailCache({ store, render });

    await cache.get({
      projectId: "project-1",
      entry: previewEntry("a".repeat(64)),
      resolveMedia: async () => null,
    });
    await cache.get({
      projectId: "project-1",
      entry: previewEntry("b".repeat(64)),
      resolveMedia: async () => null,
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(store.writeCanvasThumbnail).toHaveBeenNthCalledWith(
      2,
      "project-1",
      "b".repeat(64),
      expect.any(Uint8Array),
    );
  });

  it("rasterizes the real image bytes into their Main canvas node", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-canvas-thumbnail-"));
    const sourcePath = join(directory, "hero.svg");
    try {
      await writeFile(
        sourcePath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#f00000"/></svg>',
      );
      const bytes = await renderProjectCanvasThumbnail({
        projectId: "project-1",
        entry: previewEntry("c".repeat(64)),
        resolveMedia: async () => ({ kind: "image", path: sourcePath }),
      });
      const { data, info } = await sharp(bytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const center =
        (Math.floor(info.height / 2) * info.width +
          Math.floor(info.width / 2)) *
        info.channels;

      expect(data[center]).toBeGreaterThan(220);
      expect(data[center + 1]).toBeLessThan(30);
      expect(data[center + 2]).toBeLessThan(30);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
