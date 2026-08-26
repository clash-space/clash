import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModelProviderImplementationSchema,
  composeExecutablePluginModelCards,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (relativePath: string) =>
  JSON.parse(await readFile(join(root, relativePath), "utf8"));

describe("Tripo Provider package", () => {
  it("contributes zero Cards -- tripo-h3.1 and tripo-auto-rig are Clash built-ins owned elsewhere", async () => {
    const manifest = await json("manifest.json");
    expect(manifest.contributes.cards).toEqual([]);
  });

  it("validates structurally: manifest, provider, both bindings, and every declared contract test", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/tripo.json");
    const bindings = Object.fromEntries(
      await Promise.all(
        manifest.contributes.modelBindings.map(
          async ({ path }: { path: string }) => [path, await json(path)],
        ),
      ),
    );
    const contractTests = Object.fromEntries(
      await Promise.all(
        manifest.contractTests.map(async (path: string) => [
          path,
          await json(path),
        ]),
      ),
    );

    const validated = validateExecutablePluginPackage(
      manifest,
      {},
      contractTests,
      {
        providers: { "providers/tripo.json": provider },
        modelBindings: bindings,
      },
    );

    expect(Object.keys(validated.cards)).toEqual([]);
    expect(Object.keys(validated.modelBindings)).toEqual([
      "bindings/tripo-h3.1.json",
      "bindings/tripo-auto-rig.json",
    ]);
  });

  it("inherits providerId, apiShape, and executorExportId from the single tripo Provider for both bindings", async () => {
    const provider = await json("providers/tripo.json");
    const h31 = await json("bindings/tripo-h3.1.json");
    const rig = await json("bindings/tripo-auto-rig.json");

    const h31Implementation = ModelProviderImplementationSchema.parse(
      resolveModelBindingFromProvider(h31.spec, provider.spec),
    );
    const rigImplementation = ModelProviderImplementationSchema.parse(
      resolveModelBindingFromProvider(rig.spec, provider.spec),
    );

    expect(h31Implementation).toMatchObject({
      providerId: "tripo",
      apiShape: "tripo-v3",
      executorExportId: "tripo-execute",
      upstreamModel: "v3.1-20260211",
    });
    expect(rigImplementation).toMatchObject({
      providerId: "tripo",
      apiShape: "tripo-v3",
      executorExportId: "tripo-execute",
      upstreamModel: "v1.0-20240301",
    });
  });

  it("is a harmless no-op today, before the built-in Cards exist in packages/shared-types", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/tripo.json");
    const h31 = await json("bindings/tripo-h3.1.json");
    const rig = await json("bindings/tripo-auto-rig.json");

    const registration = (document: unknown) => ({
      pluginId: manifest.id,
      version: manifest.version,
      schemaHash: `sha256:${"a".repeat(64)}`,
      runtime: manifest.runtime,
      document,
    });

    expect(
      composeExecutablePluginModelCards(
        [],
        [],
        [
          registration({
            ...h31,
            spec: {
              ...h31.spec,
              ...resolveModelBindingFromProvider(h31.spec, provider.spec),
            },
          }),
          registration({
            ...rig,
            spec: {
              ...rig.spec,
              ...resolveModelBindingFromProvider(rig.spec, provider.spec),
            },
          }),
        ] as never,
      ),
    ).toEqual([]);
  });

  it("attaches the tripo route once a matching built-in Card exists", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/tripo.json");
    const h31 = await json("bindings/tripo-h3.1.json");
    const futureCard = {
      id: "tripo-h3.1",
      name: "Tripo H3.1",
      provider: "tripo",
      kind: "image",
      parameters: [],
    };

    const composed = composeExecutablePluginModelCards(
      [futureCard as never],
      [],
      [
        {
          pluginId: manifest.id,
          version: manifest.version,
          schemaHash: `sha256:${"a".repeat(64)}`,
          runtime: manifest.runtime,
          document: {
            ...h31,
            spec: {
              ...h31.spec,
              ...resolveModelBindingFromProvider(h31.spec, provider.spec),
            },
          },
        },
      ] as never,
    );

    expect(composed).toHaveLength(1);
    expect(composed[0]!.providerImplementations).toContainEqual(
      expect.objectContaining({
        providerId: "tripo",
        apiShape: "tripo-v3",
        upstreamModel: "v3.1-20260211",
      }),
    );
  });
});
