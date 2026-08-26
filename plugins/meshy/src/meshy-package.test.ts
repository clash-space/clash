import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModelProviderImplementationSchema,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path: string) => JSON.parse(await readFile(join(root, path), "utf8"));

describe("Meshy plugin package", () => {
  it("contributes no cards -- only a provider, bindings, and an executor", async () => {
    const manifest = await json("manifest.json");
    expect(manifest.contributes.cards).toEqual([]);
  });

  it("validates structurally as an executable plugin package", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/meshy.json");
    const bindingPaths: { path: string }[] = manifest.contributes.modelBindings;
    const bindings = Object.fromEntries(
      await Promise.all(bindingPaths.map(async ({ path }) => [path, await json(path)])),
    );
    const contractTests = Object.fromEntries(
      await Promise.all(
        manifest.contractTests.map(async (path: string) => [path, await json(path)]),
      ),
    );

    const validated = validateExecutablePluginPackage(manifest, {}, contractTests, {
      providers: { "providers/meshy.json": provider },
      modelBindings: bindings,
    });

    expect(Object.keys(validated.cards)).toEqual([]);
    expect(Object.keys(validated.providers)).toEqual(["providers/meshy.json"]);
    expect(Object.keys(validated.modelBindings).sort()).toEqual(
      ["bindings/meshy-6.json", "bindings/meshy-7.json", "bindings/meshy-auto-rig.json"].sort(),
    );
  });

  it("binds exactly the three fixed built-in card ids, and nothing else", async () => {
    const manifest = await json("manifest.json");
    const bindingPaths: { path: string }[] = manifest.contributes.modelBindings;
    const bindings = await Promise.all(bindingPaths.map(({ path }) => json(path)));
    expect(bindings.map((binding) => binding.spec.modelId).sort()).toEqual(
      ["meshy-6", "meshy-7", "meshy-auto-rig"].sort(),
    );
  });

  it("resolves every binding into a schema-valid Provider implementation, routed to meshy-execute", async () => {
    const provider = await json("providers/meshy.json");
    const bindingFiles = ["bindings/meshy-6.json", "bindings/meshy-7.json", "bindings/meshy-auto-rig.json"];
    for (const path of bindingFiles) {
      const binding = await json(path);
      const implementation = resolveModelBindingFromProvider(binding.spec, provider.spec);
      const parsed = ModelProviderImplementationSchema.parse(implementation);
      expect(parsed.providerId).toBe("meshy");
      expect(parsed.upstreamId).toBe("meshy");
      expect(parsed.apiShape).toBe("meshy");
      expect(parsed.executorExportId).toBe("meshy-execute");
    }
  });

  it("names the exact upstream ai_model or task-type Meshy documents for each binding", async () => {
    const meshy6 = await json("bindings/meshy-6.json");
    const meshy7 = await json("bindings/meshy-7.json");
    const autoRig = await json("bindings/meshy-auto-rig.json");
    expect(meshy6.spec.upstreamModel).toBe("meshy-6");
    expect(meshy7.spec.upstreamModel).toBe("meshy-7");
    expect(autoRig.spec.upstreamModel).toBe("rig");
  });

  it("declares only Host delivery forms Meshy can actually consume -- never a raw clash-asset handle", async () => {
    const manifest = await json("manifest.json");
    const bindingPaths: { path: string }[] = manifest.contributes.modelBindings;
    const bindings = await Promise.all(bindingPaths.map(({ path }) => json(path)));
    for (const binding of bindings) {
      for (const assetInput of binding.spec.assetInputs ?? []) {
        for (const representation of assetInput.representations) {
          expect(["provider-url", "bytes"]).toContain(representation);
        }
      }
    }
  });

  it("declares the auto-rig binding's asset input as a model kind, not an invented rig kind", async () => {
    const autoRig = await json("bindings/meshy-auto-rig.json");
    expect(autoRig.spec.assetInputs).toEqual([
      { match: { kinds: ["model"] }, representations: ["provider-url", "bytes"] },
    ]);
  });
});
