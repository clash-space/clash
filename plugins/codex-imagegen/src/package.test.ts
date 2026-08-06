import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateExecutablePluginPackage } from "@clash/shared-types";
import { describe, expect, it } from "vitest";
import * as imagegen from "./stdio";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Codex ImageGen executable action package", () => {
  it("ships a local action Card backed by an installable stdio plugin", async () => {
    const manifestPath = join(root, "manifest.json");
    const cardPath = join(root, "cards", "codex-imagegen.json");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(cardPath)).toBe(true);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const card = JSON.parse(await readFile(cardPath, "utf8"));
    const contractPath = "contract-tests/generate-image.json";
    const contract = JSON.parse(await readFile(join(root, contractPath), "utf8"));
    const validated = validateExecutablePluginPackage(manifest, {
      "cards/codex-imagegen.json": card,
    }, {
      [contractPath]: contract,
    });

    expect(validated.manifest).toMatchObject({
      id: "clash-codex-imagegen",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
      },
      permissions: { assets: ["read", "write"] },
    });
    expect(card).toMatchObject({
      apiVersion: "clash.card/v1",
      kind: "action-card",
      spec: {
        id: "codex-imagegen",
        outputType: "image",
        functionExportId: "generate-image",
        input: { promptModalities: ["text", "image"] },
      },
    });
  });

  it("reads reference assets, runs Codex ImageGen, and writes the generated image through the broker", async () => {
    const run = (imagegen as Record<string, unknown>).runCodexImageGeneration as
      | ((invocation: unknown, services: Record<string, unknown>) => Promise<any>)
      | undefined;
    expect(run).toBeTypeOf("function");
    if (!run) return;

    const operations: Array<Record<string, unknown>> = [];
    const result = await run({
        protocol: "clash.plugin.invoke/v1",
        invocationId: "invocation-1",
        taskId: "task-1",
        projectId: "project-1",
        target: {
          pluginId: "clash-codex-imagegen",
          version: "0.1.0",
          exportId: "generate-image",
          schemaHash: `sha256:${"a".repeat(64)}`,
          kind: "action",
        },
        input: {
          values: { prompt: "A paper-cut moon", aspect_ratio: "16:9" },
          references: [{
            slot: "image",
            index: 0,
            asset: {
              assetId: "reference-1",
              uri: "clash-asset://reference-1",
              kind: "image",
              mediaType: "image/png",
            },
          }],
        },
        actor: { kind: "user", id: "user-1" },
      }, {
        broker: async (operation: Record<string, unknown>) => {
          operations.push(operation);
          return {
            assetId: "generated-1",
            uri: "clash-asset://generated-1",
            kind: "image",
            mediaType: "image/png",
          };
        },
      });

    expect(operations).toEqual([expect.objectContaining({
      kind: "codex.image.generate",
      prompt: "A paper-cut moon",
      aspectRatio: "16:9",
      slot: "image",
      references: [expect.objectContaining({ assetId: "reference-1" })],
    })]);
    expect(result).toEqual({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [{
        slot: "image",
        kind: "asset",
        asset: {
          assetId: "generated-1",
          uri: "clash-asset://generated-1",
          kind: "image",
          mediaType: "image/png",
        },
      }],
    });
  });
});
