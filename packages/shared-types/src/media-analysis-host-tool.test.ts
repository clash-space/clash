import { describe, expect, it } from "vitest";

import {
  ExecutableMediaAnalysisOperationSchema,
  ExecutableMediaAnalysisResultSchema,
  ExecutablePluginBrokerRequestSchema,
  executablePluginDependencyError,
} from "./executable-plugin.js";

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

describe("media analysis Host tool contract", () => {
  it("freezes one media reference, card selection, and declared category prompt", () => {
    expect(
      ExecutableMediaAnalysisOperationSchema.parse({
        kind: "media.analyze",
        reference,
        modelId: "hilo-hub-media-analysis",
        category: "scene-shot",
        prompt: "Return scene and shot semantics as JSON.",
        promptVersion: "media-analysis/v1",
      }),
    ).toMatchObject({ reference, category: "scene-shot" });
  });

  it("accepts a completed provider-attributed JSON result", () => {
    expect(
      ExecutableMediaAnalysisResultSchema.parse({
        status: "completed",
        provider: "hilo-hub",
        route: "hilo-hub",
        underlyingModel: "provider-managed",
        result: { scenes: [{ description: "A wide platform shot" }] },
      }),
    ).toMatchObject({ provider: "hilo-hub", underlyingModel: "provider-managed" });
  });

  it("authorizes only plugins that explicitly contribute media analysis", () => {
    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "clash.media-analysis",
      version: "0.1.0",
      name: "Media Analysis",
      runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs" },
      contributes: {
        functions: [{ id: "analyze", kind: "action", operations: ["submit"] }],
        hostTools: ["media.analyze"],
      },
    };
    const request = ExecutablePluginBrokerRequestSchema.parse({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: {
        kind: "media.analyze",
        reference,
        modelId: "hilo-hub-media-analysis",
        category: "description",
        prompt: "Describe the media as JSON.",
        promptVersion: "media-analysis/v1",
      },
    });
    expect(executablePluginDependencyError(manifest, request)).toBeNull();
    expect(
      executablePluginDependencyError(
        { ...manifest, contributes: { ...manifest.contributes, hostTools: [] } },
        request,
      ),
    ).toMatch(/does not contribute media analysis/i);
  });
});
