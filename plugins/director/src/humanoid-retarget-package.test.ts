import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GeneratorDefinitionSpecSchema } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(join(packageRoot, relativePath), "utf8"));
}

describe("Director humanoid-retarget Generator package", () => {
  it("declares and describes the humanoid retarget Action", async () => {
    const manifest = (await readJson("manifest.json")) as {
      contributes?: {
        generators?: Array<{ id: string }>;
        functions?: Array<{
          id: string;
          kind: string;
          assetInputs?: unknown;
        }>;
      };
    };

    // Keep this assertion before reading the generator: a missing contribution
    // must be reported independently of the not-yet-shipped definition file.
    expect(manifest.contributes?.generators ?? []).toContainEqual(
      expect.objectContaining({ id: "humanoid-retarget" }),
    );
    expect(manifest.contributes?.functions ?? []).toContainEqual(
      expect.objectContaining({ id: "retarget-humanoid", kind: "action" }),
    );
    const retargetAction = manifest.contributes?.functions?.find(
      ({ id }) => id === "retarget-humanoid",
    );
    expect(retargetAction?.assetInputs).toEqual([
      {
        match: { kinds: ["model"] },
        mediaTypes: ["model/gltf-binary"],
        representations: ["bytes"],
      },
    ]);

    const generator = (await readJson("generators/humanoid-retarget.json")) as {
      spec: unknown;
    };
    const definition = GeneratorDefinitionSpecSchema.parse(generator.spec);
    const action = definition.actions.find(({ id }) => id === "retarget-humanoid");

    expect(action).toBeDefined();
    expect(action?.invocationInputs).toHaveLength(2);
    expect(action?.invocationInputs.map(({ slot }) => slot)).toEqual(["target", "motion"]);
    for (const input of action?.invocationInputs ?? []) {
      expect(input.accepts).toEqual([{ kind: "media", mediaKind: "model" }]);
      expect(input.cardinality).toEqual({ minItems: 1, maxItems: 1 });
    }

    expect(action?.parametersSchema).toMatchObject({
      type: "object",
      properties: {
        clipName: { type: "string" },
        rootMotion: { type: "string", enum: ["in-place", "preserve"] },
        footLock: { type: "string", enum: ["off", "contact"] },
      },
    });
    expect(action?.outputs).toEqual([
      expect.objectContaining({
        slot: "animated-model",
        assetType: { kind: "media", mediaKind: "model" },
        cardinality: { minItems: 1, maxItems: 1 },
      }),
    ]);
  });
});
