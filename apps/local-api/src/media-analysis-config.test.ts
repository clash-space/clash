import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalMediaAnalysisConfigStore, mediaAnalysisModelOptionFromCatalogEntry } from "./media-analysis-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("media analysis settings authority", () => {
  it("derives one option with the exact frozen implementation from the selected catalog route", () => {
    const option = mediaAnalysisModelOptionFromCatalogEntry(
      {
        model: {
          id: "multi-route-card",
          name: "VLM",
          visibility: { scope: "plugin-private" },
        },
        selectedRoute: {
          modelCode: "multi-route-card",
          kind: "text",
          providerId: "dummy-b",
          accountId: "dummy-b-account",
          upstreamId: "dummy-b",
          upstreamModel: "model-b",
          apiShape: "shape-b",
          priority: 2,
          executorPluginId: "dummy.plugin-b",
          executorExportId: "execute-b",
        },
      } as never,
      { pluginId: "dummy.consumer" },
      "image",
    );
    expect(option).toMatchObject({
      id: "multi-route-card",
      provider: "dummy-b",
      route: "shape-b",
      visibility: "plugin-private",
      underlyingModel: "model-b",
      sourceKinds: ["image"],
      implementation: {
        providerId: "dummy-b",
        accountId: "dummy-b-account",
        upstreamId: "dummy-b",
        upstreamModel: "model-b",
        apiShape: "shape-b",
        executorPluginId: "dummy.plugin-b",
        executorExportId: "execute-b",
      },
    });
    expect(option.implementation).not.toHaveProperty("priority");
  });

  it("persists a selected card id and reuses one resolver for options, save, and run", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-config-"));
    directories.push(dataDir);
    const resolveOptions = vi.fn(async (sourceKind: "image" | "video" | "audio") => [{
      id: "dummy-card",
      name: "Dummy Card",
      provider: "fallback-provider",
      route: "fallback-shape",
      consumer: { pluginId: "dummy.consumer" },
      underlyingModel: "provider-managed",
      visibility: "plugin-private" as const,
      implementation: {
        providerId: "fallback-provider",
        upstreamId: "fallback-provider",
        upstreamModel: "provider-managed",
        apiShape: "fallback-shape",
      },
      sourceKinds: [sourceKind],
    }]);
    const store = createLocalMediaAnalysisConfigStore({ dataDir, resolveOptions });

    await expect(store.modelOptions("image")).resolves.toEqual([
      expect.objectContaining({ id: "dummy-card", route: "fallback-shape" }),
    ]);
    await expect(store.update({ videoEnabled: true, modelId: "dummy-card" })).resolves.toMatchObject({
      videoEnabled: true,
      modelId: "dummy-card",
    });
    await expect(store.assertRunnable({ sourceKind: "image", modelId: "dummy-card" })).resolves.toMatchObject({
      id: "dummy-card",
      provider: "fallback-provider",
    });
    expect(resolveOptions).toHaveBeenCalledWith("image");
    expect(resolveOptions).toHaveBeenCalledWith("video");
    expect(resolveOptions).toHaveBeenCalledWith("audio");
  });

  it("round-trips user-selected video analysis and boundary refinement settings", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-config-"));
    directories.push(dataDir);
    const store = createLocalMediaAnalysisConfigStore({
      dataDir,
      resolveOptions: async (sourceKind) => [{
        id: "video-card",
        name: "Video Card",
        provider: "provider",
        route: "shape",
        consumer: { pluginId: "dummy.consumer" },
        visibility: "public" as const,
        underlyingModel: "video-model",
        implementation: {
          providerId: "provider",
          upstreamId: "provider",
          upstreamModel: "video-model",
          apiShape: "shape",
        },
        sourceKinds: [sourceKind],
      }],
    });

    const selected = {
      videoEnabled: true,
      modelId: "video-card",
      allowedCategories: ["description", "scene-shot"],
      video: {
        fps: 2,
        mediaResolution: "high" as const,
        boundaryRefinement: {
          enabled: true,
          fps: 12,
          safetyMarginSeconds: 0.75,
        },
      },
    };

    await expect(store.update(selected)).resolves.toEqual(selected);
    await expect(store.get()).resolves.toEqual(selected);
  });

  it("rejects a card when the shared resolver has no runnable route", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-config-"));
    directories.push(dataDir);
    const store = createLocalMediaAnalysisConfigStore({
      dataDir,
      resolveOptions: async () => [],
    });

    await expect(store.update({ modelId: "not-executable" })).rejects.toThrow(/configured and executable/i);
    await expect(store.assertRunnable({ sourceKind: "image", modelId: "not-executable" })).rejects.toThrow(
      /configured and executable/i,
    );
  });

  it("rejects an analysis category the user disabled", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-config-"));
    directories.push(dataDir);
    const store = createLocalMediaAnalysisConfigStore({
      dataDir,
      resolveOptions: async (sourceKind) => [{
        id: "video-model",
        name: "Video model",
        provider: "provider",
        route: "shape",
        consumer: { pluginId: "dummy.consumer" },
        visibility: "public" as const,
        underlyingModel: "video-model",
        implementation: {
          providerId: "provider",
          upstreamId: "provider",
          upstreamModel: "video-model",
          apiShape: "shape",
        },
        sourceKinds: [sourceKind],
      }],
    });
    await store.update({
      videoEnabled: true,
      modelId: "video-model",
      allowedCategories: ["description"],
    });

    await expect(store.assertRunnable({
      sourceKind: "video",
      modelId: "video-model",
      category: "scene-shot",
    })).rejects.toThrow(/category.*disabled/i);
  });

  it("rejects video analysis when disabled while preserving image and audio checks", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-media-analysis-config-"));
    directories.push(dataDir);
    const store = createLocalMediaAnalysisConfigStore({
      dataDir,
      resolveOptions: async (sourceKind) => [{
        id: `${sourceKind}-model`,
        name: sourceKind,
        provider: "provider",
        route: "shape",
        consumer: { pluginId: "dummy.consumer" },
        visibility: "public" as const,
        underlyingModel: `${sourceKind}-model`,
        implementation: {
          providerId: "provider",
          upstreamId: "provider",
          upstreamModel: `${sourceKind}-model`,
          apiShape: "shape",
        },
        sourceKinds: [sourceKind],
      }],
    });
    await expect(store.assertRunnable({ sourceKind: "video", modelId: "video-model" })).rejects.toThrow(/video.*disabled/i);
    await expect(store.assertRunnable({ sourceKind: "image", modelId: "image-model" })).resolves.toMatchObject({ id: "image-model" });
    await expect(store.assertRunnable({ sourceKind: "audio", modelId: "audio-model" })).resolves.toMatchObject({ id: "audio-model" });
  });
});
