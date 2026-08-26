import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeExecutablePluginModelCards,
  listConsumerModelCatalogEntries,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path: string) => JSON.parse(await readFile(join(root, path), "utf8"));

describe("Hilo media-analysis contribution", () => {
  it("owns a consumer-private semantic card and a normal provider binding", async () => {
    const manifest = await json("manifest.json");
    const card = await json("cards/media-analysis.json");
    const provider = await json("providers/hilo-hub.json");
    const binding = await json("bindings/media-analysis.json");
    const contractTests = Object.fromEntries(
      await Promise.all(
        manifest.contractTests.map(async (path: string) => [path, await json(path)]),
      ),
    );
    validateExecutablePluginPackage(
      manifest,
      { "cards/media-analysis.json": card },
      contractTests,
      {
        providers: { "providers/hilo-hub.json": provider },
        modelBindings: Object.fromEntries(
          await Promise.all(
            manifest.contributes.modelBindings.map(async ({ path }: { path: string }) => [path, await json(path)]),
          ),
        ),
      },
    );
    const implementation = resolveModelBindingFromProvider(binding.spec, provider.spec);
    const model = composeExecutablePluginModelCards(
      [],
      [{
        pluginId: manifest.id,
        version: manifest.version,
        schemaHash: `sha256:${"a".repeat(64)}`,
        runtime: manifest.runtime,
        document: card,
      }],
      [{
        pluginId: manifest.id,
        version: manifest.version,
        schemaHash: `sha256:${"a".repeat(64)}`,
        runtime: manifest.runtime,
        document: { ...binding, spec: { ...binding.spec, ...implementation } },
      }],
    )[0]!;

    expect(model).toMatchObject({
      semanticShape: "media_analysis",
      kind: "text",
      visibility: {
        scope: "plugin-private",
        consumers: [{ pluginId: "clash.media-analysis", definitionId: "media-analysis", actionId: "analyze" }],
      },
    });
    expect(model.providerImplementations).toContainEqual(
      expect.objectContaining({
        providerId: "hilo-hub",
        apiShape: "hub-analyse-media",
        upstreamModel: "provider-managed",
      }),
    );
    expect(listConsumerModelCatalogEntries({
      consumer: { pluginId: "another.consumer" },
      semanticShape: "media_analysis",
      outputKind: "text",
      sourceKind: "video",
      referenceCounts: { video: 1 },
      models: [model],
      configuredProviders: [{
        id: "hilo-account",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        apiShape: "hub-analyse-media",
        enabled: true,
        configuredCredentials: ["accessToken"],
      }],
      isRouteExecutable: () => true,
    })).toEqual([]);
    expect(listConsumerModelCatalogEntries({
      consumer: { pluginId: "clash.media-analysis", definitionId: "media-analysis", actionId: "analyze" },
      semanticShape: "media_analysis",
      outputKind: "text",
      sourceKind: "video",
      referenceCounts: { video: 1 },
      models: [model],
      configuredProviders: [{
        id: "hilo-account",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        apiShape: "hub-analyse-media",
        enabled: true,
        configuredCredentials: ["accessToken"],
      }],
      isRouteExecutable: () => true,
    }).map((entry) => entry.model.id)).toEqual(["hilo-hub-media-analysis"]);
  });
});
