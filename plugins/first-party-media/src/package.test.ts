import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeExecutablePluginModelCards,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("first-party media executable package", () => {
  it("ships the official media Cards needed by first- and third-party Providers", async () => {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    const cardDocuments = Object.fromEntries(await Promise.all(
      manifest.exports.cards.map(async (card: { path: string }) => [
        card.path,
        JSON.parse(await readFile(join(root, card.path), "utf8")),
      ]),
    ));
    const contractDocuments = Object.fromEntries(await Promise.all(
      manifest.contractTests.map(async (path: string) => [
        path,
        JSON.parse(await readFile(join(root, path), "utf8")),
      ]),
    ));

    const validated = validateExecutablePluginPackage(
      manifest,
      cardDocuments,
      contractDocuments,
    );
    expect(validated.manifest.exports.cards.map((card) => card.id)).toEqual([
      "elevenlabs-music-v2",
      "jimeng-motion-control-2",
      "kling-avatar",
      "kling-image-o1",
      "kling-image-o3",
      "kling-motion-control",
      "kling-video-o1",
      "kling-video-o3",
      "minimax-h3",
      "minimax-h3-startend",
      "minimax-music-3",
      "midjourney-7",
      "midjourney-8.1",
      "midjourney-niji-7",
      "music-cover",
      "seed-audio-1",
      "seedance-2-ref",
      "seedance-2-startend",
      "seedance-2-fast-ref",
      "seedance-2-fast-startend",
      "seedance-2-mini-ref",
      "seedance-2-mini-startend",
      "seedance-2.5-ref",
      "seedance-2.5-startend",
    ]);
    const registrations = Object.values(validated.cards).map((document) => ({
      pluginId: manifest.id,
      version: manifest.version,
      schemaHash: `sha256:${"a".repeat(64)}` as const,
      runtime: validated.manifest.runtime,
      permissions: validated.manifest.permissions,
      document,
    }));
    const models = composeExecutablePluginModelCards([], registrations);
    expect(models.find((model) => model.id === "minimax-h3")
      ?.providerImplementations?.find((route) => route.providerId === "fal")
      ?.projectorPluginId).toBe("clash-first-party-media");
    expect(models.find((model) => model.id === "minimax-music-3")?.task)
      .toBe("music-generation");
    for (const modelId of ["kling-video-o1", "kling-video-o3"]) {
      const model = models.find((candidate) => candidate.id === modelId);
      expect(model?.input.inputMode.audios).toBeUndefined();
      expect(model?.input.promptModalities).not.toContain("audio");
    }
  });
});
