import { describe, expect, it, vi } from "vitest";

import { createAssetActionInvocation } from "@clash/shared-types";

import {
  createAssetEditPluginModule,
  invokeAssetEditPlugin,
} from "./asset-edit-plugin.js";

describe("asset edit PluginModule", () => {
  it("runs the same Action code in local, cloud, and client realms", async () => {
    const execute = vi.fn(async () => ({
      slot: "output",
      kind: "asset" as const,
      asset: {
        assetId: "asset:edited",
        uri: "clash-asset://asset:edited",
        kind: "image" as const,
      },
    }));
    const module = createAssetEditPluginModule(execute);
    const invocation = createAssetActionInvocation({
      actionId: "image-editor",
      projectId: "project-1",
      source: { assetId: "asset:source", kind: "image" },
      params: { rotation: 90 },
      surface: "canvas",
    });

    for (const realm of ["local", "cloud", "client"] as const) {
      await expect(
        invokeAssetEditPlugin({
          realm,
          module,
          actionRunId: `edit:${realm}`,
          invocation,
        }),
      ).resolves.toEqual({ assetId: "asset:edited" });
    }
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("maps a native Generator invocation into the same Asset Action invocation", async () => {
    const execute = vi.fn(async () => ({
      slot: "output",
      kind: "asset" as const,
      asset: {
        assetId: "asset:frame",
        uri: "clash-asset://asset:frame",
        kind: "image" as const,
      },
    }));
    const module = createAssetEditPluginModule(execute);

    const result = await module.invoke({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-native",
      taskId: "run-native",
      projectId: "project-native",
      target: {
        pluginId: "clash.asset-edit",
        version: "1.0.0",
        exportId: "video-clipper",
        schemaHash: `sha256:${"b".repeat(64)}`,
        kind: "action",
      },
      operation: "submit",
      input: {
        values: { __generatorActionId: "screenshot", frameTimeSec: 1.5 },
        references: [
          {
            slot: "source",
            index: 0,
            asset: {
              assetId: "asset:source-video",
              uri: "clash-asset://asset:source-video",
              kind: "video",
              mediaType: "video/mp4",
            },
          },
        ],
      },
      assetInputs: [],
      actor: { kind: "agent", id: "agent-1" },
    });

    expect(result).toMatchObject({
      status: "completed",
      outputs: [{ slot: "output", asset: { assetId: "asset:frame" } }],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRunId: "run-native",
        invocation: {
          actionId: "video-clipper",
          projectId: "project-native",
          mode: "explicit",
          surface: "canvas",
          source: { assetId: "asset:source-video", kind: "video" },
          params: { mode: "screenshot", frameTimeSec: 1.5 },
        },
      }),
      expect.any(Object),
    );
  });
});
