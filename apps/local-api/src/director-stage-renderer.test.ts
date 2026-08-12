import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = {
  schemaVersion: 1 as const,
  scene: { backgroundColor: "#171816", grid: { visible: true, snap: false, size: 1 } },
  objects: [],
  cameras: [{
    id: "camera-a",
    name: "Camera A",
    position: [0, 1.6, 5] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    fov: 50,
  }],
  shots: [],
  activeCameraId: "camera-a",
};

describe("daemon-owned Director Stage renderer", () => {
  it("renders exact-time PNGs through the packaged DirectorViewport browser surface", async () => {
    const module = await import("./director-stage-renderer").catch(() => ({})) as Record<string, any>;
    expect(typeof module.createHeadlessDirectorStageRenderer).toBe("function");

    const runtimeRoot = await mkdtemp(join(tmpdir(), "clash-director-renderer-"));
    const bundleDir = join(runtimeRoot, "director-bundle");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "index.html"), "<script type=module src=./index.js></script>");
    await writeFile(join(bundleDir, "index.js"), "window.__CLASH_DIRECTOR_CAPTURE__=true");

    const evaluate = vi.fn(async (_fn: unknown, input: any) => ({
      dataUrl: "data:image/png;base64,AQID",
      width: input.longEdge,
      height: Math.round(input.longEdge * 9 / 16),
      activeCameraId: "camera-a",
    }));
    const page = {
      goto: vi.fn(async () => null),
      evaluate,
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const prepareBundle = vi.fn(async () => undefined);
    const renderer = module.createHeadlessDirectorStageRenderer({
      bundleDir,
      prepareBundle,
      openBrowser: vi.fn(async () => browser),
    });

    const result = await renderer.render({
      state,
      longEdge: 1280,
      frames: [
        { label: "frame-opening", timeSeconds: 0, aspectRatio: "16:9" },
        { label: "frame-action", timeSeconds: 1.25, aspectRatio: "16:9" },
      ],
    });

    expect(result.renderer).toEqual({
      id: "clash-director-viewport-webgl",
      contractVersion: 1,
    });
    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]).toMatchObject({
      label: "frame-action",
      timeSeconds: 1.25,
      width: 1280,
      height: 720,
      activeCameraId: "camera-a",
      mimeType: "image/png",
      dataBase64: "AQID",
    });
    expect(result.frames[1]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), expect.objectContaining({
      timeSeconds: 1.25,
      state,
    }));
    expect(prepareBundle).toHaveBeenCalledOnce();

    await renderer.dispose();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
