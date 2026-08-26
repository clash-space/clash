import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GeneratorDefinitionSpecSchema,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function json(relativePath: string) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

describe("generic video-enhance Generator package", () => {
  it("declares a headless Generator that recognizes no Provider by name", async () => {
    const manifest = await json("manifest.json");
    const generator = await json("generators/video-enhance.json");
    const validated = validateExecutablePluginPackage(
      manifest,
      {},
      {},
      { generators: { "generators/video-enhance.json": generator } },
    );
    expect(validated.manifest).toMatchObject({
      id: "clash.video-enhance",
      contributes: {
        cards: [],
        generators: [expect.objectContaining({ id: "video-enhance" })],
        functions: [
          expect.objectContaining({
            id: "enhance",
            kind: "action",
            operations: ["submit", "poll"],
          }),
        ],
        hostTools: ["video.enhance"],
      },
    });
    const definition = GeneratorDefinitionSpecSchema.parse(generator.spec);
    const action = definition.actions[0]!;
    expect(action.modelConsumer).toEqual({
      semanticShape: "video_enhancement",
      sourceInputSlot: "source",
    });
    expect(action.outputs).toHaveLength(1);
    expect(action.outputs[0]!.assetType).toEqual({ kind: "media", mediaKind: "video" });
    // The canonical Provider media staging slot, matched to avoid a slot-mismatch rejection at
    // publication (Provider executors conventionally key their media step `media`).
    expect(action.outputs[0]!.slot).toBe("media");
    // No provider-specific enumeration: parameters are a generic pass-through bag.
    const properties = action.parametersSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(["modelParams"]);
    expect(JSON.stringify(manifest)).not.toMatch(/volcengine|mediakit/i);
    expect(JSON.stringify(generator)).not.toMatch(/volcengine|mediakit|toolversion|scene|bitrate/i);
  });

  it("imports without starting and forwards modelParams to hostTools.videoEnhance", async () => {
    const source = join(root, "src/stdio.ts");
    expect(existsSync(source)).toBe(true);
    const { plugin } = (await import(pathToFileURL(source).href)) as {
      plugin: { start?: unknown; invoke(input: unknown, context: unknown): Promise<unknown> };
    };
    expect(plugin.start).toBeUndefined();

    const calls: Array<Record<string, unknown>> = [];
    const invocation = {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "clash.video-enhance",
        version: "0.1.0",
        exportId: "enhance",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      input: {
        values: {
          modelId: "dummy-enhance-card",
          modelParams: { scene: "common", fps: 30 },
          source: {
            projectAssetId: "asset-1",
            resourceHash: `sha256:${"b".repeat(64)}`,
            kind: "video",
          },
          generatorRevisionId: "generator-revision-1",
          actionRunId: "action-run-1",
        },
        references: [
          {
            slot: "source",
            index: 0,
            asset: {
              assetId: "asset-1",
              uri: "clash-asset://asset-1",
              kind: "video",
              mediaType: "video/mp4",
            },
          },
        ],
      },
      assetInputs: [],
      actor: { kind: "agent", id: "agent-1" },
      operation: "submit",
    };
    const assetHandle = {
      assetId: "asset-2",
      uri: "clash-asset://asset-2",
      kind: "video",
      mediaType: "video/mp4",
    };
    const result = await plugin.invoke(invocation, {
      hostTools: {
        videoEnhance: async (request: Record<string, unknown>) => {
          calls.push(request);
          return {
            status: "completed",
            provider: "dummy-provider",
            route: "dummy-shape",
            underlyingModel: "provider-managed",
            asset: assetHandle,
          };
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({ scene: "common", fps: 30 });
    expect(calls[0]!.modelId).toBe("dummy-enhance-card");
    expect(result).toMatchObject({
      status: "completed",
      outputs: [{ slot: "media", kind: "asset", asset: assetHandle }],
    });
  });

  it("returns an accepted step with the Host poll state, unmodified", async () => {
    const source = join(root, "src/stdio.ts");
    const { plugin } = (await import(pathToFileURL(source).href)) as {
      plugin: { invoke(input: unknown, context: unknown): Promise<unknown> };
    };
    const invocation = {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-2",
      taskId: "task-2",
      projectId: "project-1",
      target: {
        pluginId: "clash.video-enhance",
        version: "0.1.0",
        exportId: "enhance",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      input: {
        values: {
          modelId: "dummy-enhance-card",
          source: {
            projectAssetId: "asset-1",
            resourceHash: `sha256:${"b".repeat(64)}`,
            kind: "video",
          },
        },
        references: [
          {
            slot: "source",
            index: 0,
            asset: {
              assetId: "asset-1",
              uri: "clash-asset://asset-1",
              kind: "video",
              mediaType: "video/mp4",
            },
          },
        ],
      },
      assetInputs: [],
      actor: { kind: "agent", id: "agent-1" },
      operation: "submit",
    };
    const result = await plugin.invoke(invocation, {
      hostTools: {
        videoEnhance: async () => ({
          status: "accepted",
          poll: { upstreamTaskId: "provider-task-1" },
          retryAfterMs: 500,
        }),
      },
    });
    expect(result).toMatchObject({
      status: "accepted",
      pollState: { upstreamTaskId: "provider-task-1" },
      retryAfterMs: 500,
    });
  });
});
