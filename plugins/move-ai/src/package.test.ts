import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_CARDS,
  ModelProviderImplementationSchema,
  composeExecutablePluginModelCards,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (relativePath: string) =>
  JSON.parse(await readFile(join(root, relativePath), "utf8"));

describe("Move AI Provider package", () => {
  it("contributes zero Cards -- move-ai-s2 is a Clash built-in owned elsewhere", async () => {
    const manifest = await json("manifest.json");
    expect(manifest.contributes.cards).toEqual([]);
  });

  it("validates structurally: manifest, provider, the binding, and every declared contract test", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/move-ai.json");
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
        providers: { "providers/move-ai.json": provider },
        modelBindings: bindings,
      },
    );

    expect(Object.keys(validated.cards)).toEqual([]);
    expect(Object.keys(validated.modelBindings)).toEqual([
      "bindings/move-ai-s2.json",
    ]);
  });

  it("declares a secure apiKey auth field with an official Move AI developer portal notice", async () => {
    const provider = await json("providers/move-ai.json");
    const methods = provider.spec.auth.methods;
    expect(methods).toHaveLength(1);
    const [method] = methods;
    expect(method.id).toBe("api-key");
    const fields = method.form.filter((item: { kind: string }) => item.kind === "field");
    expect(fields).toEqual([
      { kind: "field", key: "apiKey", label: "API key", secret: true },
    ]);
    const notice = method.form.find((item: { kind: string }) => item.kind === "notice");
    expect(notice?.text).toMatch(/dev\.move\.ai/);
  });

  it("only accepts video, only as bytes, for the move-ai-s2 binding", async () => {
    const binding = await json("bindings/move-ai-s2.json");
    expect(binding.spec.assetInputs).toEqual([
      {
        match: { kinds: ["video"] },
        representations: ["bytes"],
        mediaTypes: ["video/mp4", "video/quicktime", "video/x-msvideo"],
      },
    ]);
  });

  it("inherits providerId, apiShape, and executorExportId from the single move-ai Provider, and pins upstreamModel to S2", async () => {
    const provider = await json("providers/move-ai.json");
    const binding = await json("bindings/move-ai-s2.json");

    const implementation = ModelProviderImplementationSchema.parse(
      resolveModelBindingFromProvider(binding.spec, provider.spec),
    );

    expect(implementation).toMatchObject({
      providerId: "move-ai",
      apiShape: "move-ai-ugc",
      executorExportId: "move-ai-execute",
      upstreamModel: "S2",
    });
  });

  it("attaches the move-ai Provider implementation to the actual built-in move-ai-s2 Card", async () => {
    const manifest = await json("manifest.json");
    const provider = await json("providers/move-ai.json");
    const binding = await json("bindings/move-ai-s2.json");

    const moveAiCard = MODEL_CARDS.find((candidate) => candidate.id === "move-ai-s2");
    if (!moveAiCard) throw new Error("Missing built-in model card: move-ai-s2");
    expect(moveAiCard.kind).toBe("model");

    const composed = composeExecutablePluginModelCards(
      MODEL_CARDS,
      [],
      [registrationFor(manifest, binding, provider)] as never,
    );

    const composedCard = composed.find((candidate) => candidate.id === "move-ai-s2");
    if (!composedCard) throw new Error("Missing composed model card: move-ai-s2");
    expect(composedCard.kind).toBe("model");
    expect(composedCard.providerImplementations).toContainEqual(
      expect.objectContaining({
        providerId: "move-ai",
        apiShape: "move-ai-ugc",
        upstreamModel: "S2",
      }),
    );
  });
});

function registrationFor(
  manifest: { id: string; version: string; runtime: unknown },
  binding: { spec: Record<string, unknown> },
  provider: { spec: Record<string, unknown> },
) {
  return {
    pluginId: manifest.id,
    version: manifest.version,
    schemaHash: `sha256:${"a".repeat(64)}`,
    runtime: manifest.runtime,
    document: {
      ...binding,
      spec: {
        ...binding.spec,
        ...resolveModelBindingFromProvider(binding.spec as never, provider.spec as never),
      },
    },
  };
}
