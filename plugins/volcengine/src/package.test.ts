import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateExecutablePluginPackage } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path: string) =>
  JSON.parse(await readFile(join(root, path), "utf8"));

type Contribution = { id: string; path: string };

async function packageDocuments() {
  const manifest = await json("manifest.json");
  const load = async (entries: Contribution[]) =>
    Object.fromEntries(
      await Promise.all(
        entries.map(async ({ path }) => [path, await json(path)] as const),
      ),
    );
  return {
    manifest,
    providers: await load(manifest.contributes.providers),
    modelBindings: await load(manifest.contributes.modelBindings),
    cards: await load(manifest.contributes.cards),
    contractTests: Object.fromEntries(
      await Promise.all(
        (manifest.contractTests as string[]).map(
          async (path) => [path, await json(path)] as const,
        ),
      ),
    ),
  };
}

describe("Volcengine plugin provider identity", () => {
  it("names the ModelArk Provider volcengine-modelark, so no Provider claims the bare vendor id", async () => {
    const { manifest, providers } = await packageDocuments();

    const declared = (manifest.contributes.providers as Contribution[]).map(
      (entry) => entry.id,
    );
    expect(declared).not.toContain("volcengine");
    expect(declared).toContain("volcengine-modelark");

    const specIds = (
      Object.values(providers) as { spec: { id: string } }[]
    ).map((document) => document.spec.id);
    expect(specIds).not.toContain("volcengine");
    expect(specIds).toContain("volcengine-modelark");
  });

  it("keeps each Provider's manifest entry id, file name, spec.id and upstreamId identical", async () => {
    const { manifest, providers } = await packageDocuments();

    for (const entry of manifest.contributes.providers as Contribution[]) {
      const document = providers[entry.path] as {
        spec: { id: string; upstreamId: string };
      };
      expect(entry.path).toBe(`providers/${entry.id}.json`);
      expect(document.spec.id).toBe(entry.id);
      expect(document.spec.upstreamId).toBe(entry.id);
    }
  });
});

describe("Volcengine plugin model bindings", () => {
  it("declares providerId explicitly on every binding, naming a Provider this package exports", async () => {
    const { manifest, providers, modelBindings } = await packageDocuments();

    const providerIds = new Set(
      (Object.values(providers) as { spec: { id: string } }[]).map(
        (document) => document.spec.id,
      ),
    );
    const entries = Object.entries(modelBindings) as [
      string,
      { spec: { providerId?: string } },
    ][];
    expect(entries.length).toBeGreaterThan(0);

    for (const [path, document] of entries) {
      expect(
        document.spec.providerId,
        `${path} must declare providerId`,
      ).toBeTypeOf("string");
      expect(providerIds).toContain(document.spec.providerId);
    }
    void manifest;
  });

  it("activates the package: multi-Provider binding inheritance resolves without guessing", async () => {
    const { manifest, providers, modelBindings, cards, contractTests } =
      await packageDocuments();

    const validated = validateExecutablePluginPackage(
      manifest,
      cards,
      contractTests,
      { providers, modelBindings },
    );

    expect(Object.keys(validated.modelBindings)).toEqual(
      Object.keys(modelBindings),
    );
    expect(
      validated.modelBindings["bindings/video-enhance.json"].spec.providerId,
    ).toBe("volcengine-mediakit");
  });
});
