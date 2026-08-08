import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiApp } from "./app";

describe("Director Stage capture host route", () => {
  it("exposes the injected product renderer without fabricating a fallback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-director-capture-route-"));
    const render = vi.fn(async () => ({
      renderer: {
        id: "clash-director-viewport-webgl" as const,
        contractVersion: 1 as const,
      },
      stateSha256: "a".repeat(64),
      frames: [{
        label: "frame-opening",
        timeSeconds: 0,
        aspectRatio: "16:9" as const,
        activeCameraId: "camera-a",
        width: 1280,
        height: 720,
        mimeType: "image/png" as const,
        dataBase64: "AQID",
        sha256: "b".repeat(64),
      }],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorStageRenderer: { render, dispose: async () => undefined },
    });
    const request = {
      state: {
        schemaVersion: 1,
        scene: { backgroundColor: "#171816", grid: { visible: true, snap: false, size: 1 } },
        objects: [],
        cameras: [],
        shots: [],
      },
      longEdge: 1280,
      frames: [{ label: "frame-opening", timeSeconds: 0, aspectRatio: "16:9" }],
    };

    const response = await app.request("/api/v1/local/director-stage/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
      frames: [{ label: "frame-opening", dataBase64: "AQID" }],
    });
    expect(render).toHaveBeenCalledWith(request);
  });

  it("fails closed when the daemon has no Director product renderer", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-director-capture-missing-"));
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const response = await app.request("/api/v1/local/director-stage/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: {}, longEdge: 1280, frames: [] }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Director Stage product renderer is unavailable",
    });
  });
});
