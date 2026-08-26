import { createExecutorContext } from "@clash/action-sdk";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";
import { describe, expect, it, vi } from "vitest";

import { plugin } from "./stdio.js";

const invocation: ExecutablePluginInvocation = {
  protocol: "clash.plugin.invoke/v1",
  invocationId: "capture-1",
  taskId: "run-1",
  projectId: "project-1",
  target: { pluginId: "clash.director", version: "0.1.0", exportId: "capture-frame", schemaHash: `sha256:${"0".repeat(64)}`, kind: "action" },
  operation: "submit",
  input: { values: { stage: { name: "Stage", owner: { kind: "project" }, state: { scene: {} } }, label: " opening ", timeSeconds: 1.25, aspectRatio: "16:9", longEdge: 1920 }, references: [] },
  assetInputs: [], actor: { kind: "agent" },
};

describe("Director bundled Action", () => {
  it("passes the strict Stage envelope and pinned frame parameters to the Host tool", async () => {
    const capture = vi.fn(async () => ({ mediaType: "image/png" as const, width: 1920, height: 1080, bytesBase64: "AQ==" }));
    const upload = vi.fn(async () => ({ slot: "frame", kind: "asset" as const, asset: { assetId: "frame-1", uri: "clash-asset://frame-1", kind: "image" as const, mediaType: "image/png" } }));
    const result = await plugin.invoke(invocation, createExecutorContext({ upload, hostTools: { directorStageCaptureFrame: capture } }));
    expect(capture).toHaveBeenCalledWith({ stage: invocation.input.values.stage, label: "opening", timeSeconds: 1.25, aspectRatio: "16:9", longEdge: 1920 });
    expect(upload).toHaveBeenCalledWith({ slot: "frame", kind: "image", mediaType: "image/png", bytes: Uint8Array.of(1) });
    expect(result).toMatchObject({ status: "completed", outputs: [{ slot: "frame", kind: "asset" }] });
  });

  it("rejects extra Stage envelope fields before calling the Host", async () => {
    const capture = vi.fn();
    const malformed = structuredClone(invocation);
    malformed.input.values.stage = { ...(malformed.input.values.stage as object), revisionId: "not-part-of-envelope" };
    await expect(plugin.invoke(malformed, createExecutorContext({ hostTools: { directorStageCaptureFrame: capture } }))).rejects.toThrow(/strict Stage envelope/i);
    expect(capture).not.toHaveBeenCalled();
  });
});
