import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalApiApp } from "./app.js";
import type { LocalMediaAnalysisConfig, LocalMediaAnalysisConfigStore } from "./media-analysis-config.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("media analysis Settings routes", () => {
  it("returns persisted config and declaration-derived options", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-route-"));
    directories.push(dataDir);
    const store: LocalMediaAnalysisConfigStore = {
      get: async () => ({
        videoEnabled: true,
        modelId: "vlm",
        allowedCategories: null,
        video: {
          fps: 1,
          mediaResolution: "medium",
          boundaryRefinement: { enabled: false, fps: 24, safetyMarginSeconds: 0.5 },
        },
      }),
      update: async () => ({
        videoEnabled: true,
        modelId: "vlm",
        allowedCategories: null,
        video: {
          fps: 1,
          mediaResolution: "medium",
          boundaryRefinement: { enabled: false, fps: 24, safetyMarginSeconds: 0.5 },
        },
      }),
      modelOptions: async (kind) => [{
        id: "vlm", name: "VLM", provider: "google", route: "generate-content",
        consumer: { pluginId: "dummy.consumer" },
        visibility: "public", underlyingModel: "vlm",
        implementation: {
          providerId: "google",
          upstreamId: "google-ai-studio",
          upstreamModel: "vlm",
          apiShape: "generate-content",
        },
        sourceKinds: [kind],
      }],
      assertRunnable: async () => { throw new Error("not called"); },
    };
    const generatorDocument = JSON.parse(
      await readFile(new URL("../../../plugins/media-analysis/generators/media-analysis.json", import.meta.url), "utf8"),
    );
    const app = createLocalApiApp({
      dataDir,
      mediaAnalysisConfig: store,
      listPluginGenerators: async () => [{
        pluginId: "clash.media-analysis",
        version: "0.1.0",
        schemaHash: `sha256:${"a".repeat(64)}`,
        document: generatorDocument,
      }],
    });
    const response = await app.request("/api/v1/local/media-analysis?sourceKind=video");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      videoEnabled: true,
      modelId: "vlm",
      modelOptions: [expect.objectContaining({ id: "vlm" })],
      categoryOptions: expect.arrayContaining([
        expect.objectContaining({ id: "description" }),
        expect.objectContaining({ id: "audio-semantics" }),
      ]),
    });
  });

  it("persists PUT config through the settings authority", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-route-"));
    directories.push(dataDir);
    let value: LocalMediaAnalysisConfig = {
      videoEnabled: false,
      modelId: null as string | null,
      allowedCategories: null as string[] | null,
      video: {
        fps: 1,
        mediaResolution: "medium" as const,
        boundaryRefinement: { enabled: false, fps: 24, safetyMarginSeconds: 0.5 },
      },
    };
    const store: LocalMediaAnalysisConfigStore = {
      get: async () => value,
      update: async (input) => (value = { ...value, ...input }),
      modelOptions: async () => [],
      assertRunnable: async () => { throw new Error("not called"); },
    };
    const app = createLocalApiApp({ dataDir, mediaAnalysisConfig: store });
    const response = await app.request("/api/v1/local/media-analysis", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoEnabled: true,
        modelId: "vlm",
        allowedCategories: ["description", "scene-shot"],
        video: {
          fps: 2,
          mediaResolution: "high",
          boundaryRefinement: { enabled: true, fps: 12, safetyMarginSeconds: 0.75 },
        },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      videoEnabled: true,
      modelId: "vlm",
      allowedCategories: ["description", "scene-shot"],
      video: {
        fps: 2,
        mediaResolution: "high",
        boundaryRefinement: { enabled: true, fps: 12, safetyMarginSeconds: 0.75 },
      },
    });
  });
});
