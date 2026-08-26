import { describe, expect, it } from "vitest";

import type { ActionRunModelRoute } from "@clash/shared-types";

import { createLocalVideoEnhanceService } from "./local-video-enhance.js";
import type { ProviderPluginExecutor } from "./local-aigc.js";

const executorBinding = {
  pluginId: "clash.some-provider",
  version: "1.2.0",
  exportId: "some-provider-execute",
  schemaHash: `sha256:${"c".repeat(64)}`,
} as const;

const route: ActionRunModelRoute = {
  upstreamId: "some-upstream",
  upstreamModel: "some-model",
  apiShape: "some-shape",
  providerId: "some-provider",
  accountId: "account-1",
  executorPluginId: executorBinding.pluginId,
  executorExportId: executorBinding.exportId,
  executorBinding,
  assetInputs: [
    { match: { kinds: ["video"] }, representations: ["provider-url"] },
  ],
};

const reference = {
  slot: "source",
  index: 0,
  asset: {
    assetId: "asset-1",
    uri: "clash-asset://asset-1",
    kind: "video" as const,
    mediaType: "video/mp4",
  },
};

const mediaHandle = {
  assetId: "asset-2",
  uri: "clash-asset://asset-2",
  kind: "video" as const,
  mediaType: "video/mp4",
};

describe("createLocalVideoEnhanceService", () => {
  it("dispatches to exactly the frozen route's Provider executor, never a hardcoded name", async () => {
    const calls: unknown[] = [];
    const providerPluginExecutor: ProviderPluginExecutor = async (request) => {
      calls.push(request);
      return {
        status: "completed",
        binding: executorBinding,
        media: mediaHandle,
      };
    };
    const service = createLocalVideoEnhanceService({ providerPluginExecutor });
    const result = await service.enhance({
      projectId: "project-1",
      invocationId: "invocation-1",
      taskId: "task-1",
      reference,
      modelId: "card-1",
      route,
      params: { scene: "common" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pluginId: executorBinding.pluginId,
      exportId: executorBinding.exportId,
      binding: executorBinding,
      accountId: "account-1",
      assetInputs: route.assetInputs,
    });
    expect(result).toMatchObject({ status: "completed", asset: mediaHandle });
  });

  it("propagates an accepted step's poll state and retry pacing verbatim", async () => {
    const providerPluginExecutor: ProviderPluginExecutor = async () => ({
      status: "accepted",
      binding: executorBinding,
      pollState: { upstreamTaskId: "provider-task-1" },
      retryAfterMs: 2_000,
    });
    const service = createLocalVideoEnhanceService({ providerPluginExecutor });
    const result = await service.enhance({
      projectId: "project-1",
      invocationId: "invocation-1",
      taskId: "task-1",
      reference,
      modelId: "card-1",
      route,
      params: {},
    });
    expect(result).toEqual({
      status: "accepted",
      poll: { upstreamTaskId: "provider-task-1" },
      retryAfterMs: 2_000,
    });
  });

  it("rejects a Provider executor binding that drifted between selection and invocation", async () => {
    const providerPluginExecutor: ProviderPluginExecutor = async () => ({
      status: "completed",
      // Same plugin/export, but a newer version than the frozen Run authority pinned -- as if the
      // plugin were upgraded between this Run's submit and a later poll.
      binding: { ...executorBinding, version: "1.3.0", schemaHash: `sha256:${"d".repeat(64)}` },
      media: mediaHandle,
    });
    const service = createLocalVideoEnhanceService({ providerPluginExecutor });
    await expect(
      service.enhance({
        projectId: "project-1",
        invocationId: "invocation-1",
        taskId: "task-1",
        reference,
        modelId: "card-1",
        route,
        params: {},
      }),
    ).rejects.toThrow(/binding drifted/i);
  });

  it("rejects a Provider executor resolved to a different plugin than the frozen route names", async () => {
    const providerPluginExecutor: ProviderPluginExecutor = async () => ({
      status: "completed",
      binding: { ...executorBinding, pluginId: "clash.a-different-provider" },
      media: mediaHandle,
    });
    const service = createLocalVideoEnhanceService({ providerPluginExecutor });
    await expect(
      service.enhance({
        projectId: "project-1",
        invocationId: "invocation-1",
        taskId: "task-1",
        reference,
        modelId: "card-1",
        route,
        params: {},
      }),
    ).rejects.toThrow(/expected clash\.some-provider/i);
  });
});
