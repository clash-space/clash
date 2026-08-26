import { describe, expect, it } from "vitest";

import type { ModelCard, ModelUpstreamRoute, ProviderAccountAvailability } from "./index.js";
import { ModelCardSchema, listConsumerModelCatalogEntries } from "./index.js";

const implementation = (
  providerId: string,
  input: Partial<NonNullable<ModelCard["providerImplementations"]>[number]> = {},
) => ({
  providerId,
  upstreamId: providerId,
  upstreamModel: `${providerId}-managed`,
  apiShape: `${providerId}-shape`,
  executorPluginId: `${providerId}.plugin`,
  executorExportId: "execute",
  priority: providerId === "route-a" ? 1 : 2,
  ...input,
});

function card(input: {
  id: string;
  shape?: string;
  modalities?: Array<"text" | "image" | "video" | "audio">;
  visibility?: unknown;
  implementations?: ReturnType<typeof implementation>[];
}): ModelCard {
  const modalities = input.modalities ?? ["text", "image", "video", "audio"];
  return ModelCardSchema.parse({
    id: input.id,
    aliases: [],
    name: input.id,
    provider: "dummy",
    kind: "text",
    semanticShape: input.shape,
    visibility: input.visibility,
    parameters: [],
    defaultParams: {},
    defaultAspectRatio: "1:1",
    input: {
      requiresPrompt: true,
      inputMode: {
        ...(modalities.includes("image") ? { images: { max: 1 } } : {}),
        ...(modalities.includes("video") ? { videos: { max: 1 } } : {}),
        ...(modalities.includes("audio") ? { audios: { max: 1 } } : {}),
      },
      promptModalities: modalities,
    },
    providerImplementations: input.implementations ?? [implementation("route-b")],
  });
}

const providers = (...ids: string[]): ProviderAccountAvailability[] =>
  ids.map((id) => ({
    id: `${id}-account`,
    providerId: id,
    upstreamId: id,
    apiShape: `${id}-shape`,
    enabled: true,
    configuredCredentials: [],
  }));

const executable = (allowed: readonly string[]) => (route: ModelUpstreamRoute) =>
  allowed.includes(route.providerId ?? "");

describe("consumer model discovery", () => {
  it("enforces generic plugin-private consumer scope without product IDs", () => {
    const publicCard = card({ id: "public", shape: "media_analysis" });
    const privateCard = card({
      id: "private",
      shape: "media_analysis",
      visibility: {
        scope: "plugin-private",
        consumers: [{ pluginId: "dummy.consumer", definitionId: "inspect" }],
      },
    });
    const query = {
      outputKind: "text" as const,
      semanticShape: "media_analysis",
      sourceKind: "image",
      referenceCounts: { image: 1 },
      models: [publicCard, privateCard],
      configuredProviders: providers("route-b"),
      isRouteExecutable: executable(["route-b"]),
    };

    expect(listConsumerModelCatalogEntries(query).map((entry) => entry.model.id)).toEqual([
      "public",
    ]);
    expect(
      listConsumerModelCatalogEntries({
        ...query,
        consumer: { pluginId: "other.consumer", definitionId: "inspect" },
      }).map((entry) => entry.model.id),
    ).toEqual(["public"]);
    expect(
      listConsumerModelCatalogEntries({
        ...query,
        consumer: { pluginId: "dummy.consumer", definitionId: "inspect" },
      }).map((entry) => entry.model.id),
    ).toEqual(["public", "private"]);
  });

  it("filters shape, exact source modality, provider readiness, and route executability", () => {
    const candidates = [
      card({ id: "wrong-shape", shape: "another_shape" }),
      card({ id: "image-only", shape: "media_analysis", modalities: ["text", "image"] }),
      card({ id: "disabled", shape: "media_analysis", implementations: [implementation("route-a")] }),
      card({
        id: "missing-credential",
        shape: "media_analysis",
        implementations: [implementation("route-c", { requiredCredentials: ["token"] })],
      }),
      card({ id: "nonexecutable", shape: "media_analysis", implementations: [implementation("route-d")] }),
      card({ id: "runnable", shape: "media_analysis", implementations: [implementation("route-b")] }),
    ];

    expect(
      listConsumerModelCatalogEntries({
        consumer: { pluginId: "dummy.consumer" },
        outputKind: "text",
        semanticShape: "media_analysis",
        sourceKind: "video",
        referenceCounts: { video: 1 },
        models: candidates,
        configuredProviders: [
          { ...providers("route-a")[0]!, enabled: false },
          ...providers("route-b", "route-c", "route-d"),
        ],
        isRouteExecutable: executable(["route-b"]),
      }).map((entry) => entry.model.id),
    ).toEqual(["runnable"]);
  });

  it("keeps one card's provider implementations and selects an available fallback route", () => {
    const multi = card({
      id: "multi",
      shape: "media_analysis",
      implementations: [implementation("route-a"), implementation("route-b")],
    });

    const [entry] = listConsumerModelCatalogEntries({
      consumer: { pluginId: "dummy.consumer" },
      outputKind: "text",
      semanticShape: "media_analysis",
      sourceKind: "audio",
      referenceCounts: { audio: 1 },
      models: [multi],
      configuredProviders: providers("route-a", "route-b"),
      isRouteExecutable: executable(["route-b"]),
    });

    expect(entry?.model.providerImplementations?.map((route) => route.providerId)).toEqual([
      "route-a",
      "route-b",
    ]);
    expect(entry?.selectedRoute?.providerId).toBe("route-b");
  });
});
