import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models.js";
import { capability, validateRefs } from "./model-capabilities.js";

/**
 * Meshy (meshy-6, meshy-7, meshy-auto-rig) and Tripo (tripo-h3.1, tripo-auto-rig) built-in Cards.
 *
 * Parameters here are constrained to what `plugins/meshy` and `plugins/tripo` already implement
 * and test against real upstream docs:
 *   - Meshy: `PBR` (boolean, wire key the adapter reads verbatim), `textureResolution`
 *     (2k/4k/8k), `poseMode` (a-pose/t-pose/""), `targetPolycount` (100-300000 on the remesh
 *     path), and auto-rig's `heightMeters` (positive).
 *   - Tripo: `pbr`, `textureQuality` (standard/detailed/extreme), `geometryQuality`
 *     (standard/detailed), `faceLimit` (1-1,500,000), `autoSize`.
 * None of these have a documented default, so no card sets `defaultValue` or `defaultParams`
 * for them -- that would be an invented value the plugin's own tests never assert.
 */
describe("Meshy model cards", () => {
  const meshy6 = MODEL_CARDS.find((card) => card.id === "meshy-6");
  const meshy7 = MODEL_CARDS.find((card) => card.id === "meshy-7");
  const meshyAutoRig = MODEL_CARDS.find((card) => card.id === "meshy-auto-rig");

  it("declares meshy-6 and meshy-7 as two separate model-kind Cards, not a shared family", () => {
    expect(meshy6).toBeDefined();
    expect(meshy7).toBeDefined();
    expect(meshy6!.id).not.toBe(meshy7!.id);
    expect(meshy6!.kind).toBe("model");
    expect(meshy7!.kind).toBe("model");
    expect(meshy6).not.toHaveProperty("family");
    expect(meshy7).not.toHaveProperty("family");
  });

  it("requires a prompt and accepts at most one reference image on meshy-6 and meshy-7", () => {
    for (const card of [meshy6, meshy7]) {
      expect(card!.input.requiresPrompt).toBe(true);
      expect(card!.input.inputMode.images?.max).toBe(1);
      expect(card!.input.promptModalities).toEqual(
        expect.arrayContaining(["text", "image"]),
      );
      expect(card!.input.inputMode.models).toBeUndefined();
    }
  });

  it("rejects a second reference image via the shared capability validator", () => {
    expect(
      validateRefs(meshy6!, { image: 1 }, { prompt: "a chestnut horse" }),
    ).toBeNull();
    expect(
      validateRefs(meshy6!, { image: 2 }, { prompt: "a chestnut horse" }),
    ).toMatch(/at most 1 reference image/i);
  });

  it("exposes exactly the four generation parameters the executor understands, with no invented defaults", () => {
    for (const card of [meshy6, meshy7]) {
      const ids = card!.parameters.map((parameter) => parameter.id).sort();
      expect(ids).toEqual(
        ["PBR", "poseMode", "targetPolycount", "textureResolution"].sort(),
      );

      const pbr = card!.parameters.find((parameter) => parameter.id === "PBR")!;
      expect(pbr.type).toBe("boolean");
      expect(pbr.defaultValue).toBeUndefined();

      const textureResolution = card!.parameters.find(
        (parameter) => parameter.id === "textureResolution",
      )!;
      expect(textureResolution.type).toBe("select");
      expect((textureResolution.options ?? []).map((option) => option.value)).toEqual([
        "2k",
        "4k",
        "8k",
      ]);
      expect(textureResolution.defaultValue).toBeUndefined();

      const poseMode = card!.parameters.find((parameter) => parameter.id === "poseMode")!;
      expect(poseMode.type).toBe("select");
      expect((poseMode.options ?? []).map((option) => option.value)).toEqual(
        expect.arrayContaining(["a-pose", "t-pose"]),
      );
      expect(poseMode.defaultValue).toBeUndefined();

      const targetPolycount = card!.parameters.find(
        (parameter) => parameter.id === "targetPolycount",
      )!;
      expect(targetPolycount.type).toBe("number");
      expect(targetPolycount.min).toBe(100);
      expect(targetPolycount.max).toBe(300_000);
      expect(targetPolycount.defaultValue).toBeUndefined();
    }
    expect(meshy6!.defaultParams).toEqual({});
    expect(meshy7!.defaultParams).toEqual({});
  });

  it("declares meshy-auto-rig as a model-to-model Card requiring exactly one model reference and no prompt", () => {
    expect(meshyAutoRig).toBeDefined();
    expect(meshyAutoRig!.kind).toBe("model");
    expect(meshyAutoRig!.input.requiresPrompt).toBe(false);
    expect(meshyAutoRig!.input.inputMode.models).toEqual(
      expect.objectContaining({ min: 1, max: 1 }),
    );
    expect(meshyAutoRig!.input.inputMode.images).toBeUndefined();
    expect(meshyAutoRig!.input.promptModalities).toEqual(["model"]);

    const ids = meshyAutoRig!.parameters.map((parameter) => parameter.id);
    expect(ids).toEqual(["heightMeters"]);
    const heightMeters = meshyAutoRig!.parameters[0]!;
    expect(heightMeters.type).toBe("number");
    expect(heightMeters.defaultValue).toBeUndefined();
  });

  it("enforces the declared model-reference bound for meshy-auto-rig through the shared capability validator", () => {
    expect(
      validateRefs(meshyAutoRig!, { model: 1 }, { enforceMinimums: true }),
    ).toBeNull();
    expect(
      validateRefs(meshyAutoRig!, { model: 0 }, { enforceMinimums: true }),
    ).toMatch(/at least 1 reference model/i);
    expect(
      validateRefs(meshyAutoRig!, { model: 2 }, { enforceMinimums: true }),
    ).toMatch(/at most 1 reference model/i);
  });

  it("does not introduce a separate rig kind -- every Meshy Card stays kind: model", () => {
    for (const card of [meshy6, meshy7, meshyAutoRig]) {
      expect(card!.kind).toBe("model");
    }
  });
});

describe("Tripo model cards", () => {
  const tripoH31 = MODEL_CARDS.find((card) => card.id === "tripo-h3.1");
  const tripoAutoRig = MODEL_CARDS.find((card) => card.id === "tripo-auto-rig");

  it("declares tripo-h3.1 as one Card covering text-to-3d and image-to-3d, not split by modality", () => {
    expect(tripoH31).toBeDefined();
    expect(tripoH31!.kind).toBe("model");
    expect(tripoH31!.input.requiresPrompt).toBe(true);
    expect(tripoH31!.input.inputMode.images?.max).toBe(1);
    expect(tripoH31!.input.promptModalities).toEqual(
      expect.arrayContaining(["text", "image"]),
    );
    expect(MODEL_CARDS.filter((card) => card.id.startsWith("tripo-h3.1"))).toHaveLength(1);
  });

  it("rejects a second reference image on tripo-h3.1", () => {
    expect(validateRefs(tripoH31!, { image: 1 }, { prompt: "a cat" })).toBeNull();
    expect(validateRefs(tripoH31!, { image: 2 }, { prompt: "a cat" })).toMatch(
      /at most 1 reference image/i,
    );
  });

  it("exposes exactly the five Tripo v1 quality parameters the executor understands, with no invented defaults", () => {
    const ids = tripoH31!.parameters.map((parameter) => parameter.id).sort();
    expect(ids).toEqual(
      ["autoSize", "faceLimit", "geometryQuality", "pbr", "textureQuality"].sort(),
    );

    const pbr = tripoH31!.parameters.find((parameter) => parameter.id === "pbr")!;
    expect(pbr.type).toBe("boolean");
    expect(pbr.defaultValue).toBeUndefined();

    const textureQuality = tripoH31!.parameters.find(
      (parameter) => parameter.id === "textureQuality",
    )!;
    expect(textureQuality.type).toBe("select");
    expect((textureQuality.options ?? []).map((option) => option.value)).toEqual([
      "standard",
      "detailed",
      "extreme",
    ]);
    expect(textureQuality.defaultValue).toBeUndefined();

    const geometryQuality = tripoH31!.parameters.find(
      (parameter) => parameter.id === "geometryQuality",
    )!;
    expect(geometryQuality.type).toBe("select");
    expect((geometryQuality.options ?? []).map((option) => option.value)).toEqual([
      "standard",
      "detailed",
    ]);
    expect(geometryQuality.defaultValue).toBeUndefined();

    const faceLimit = tripoH31!.parameters.find(
      (parameter) => parameter.id === "faceLimit",
    )!;
    expect(faceLimit.type).toBe("number");
    expect(faceLimit.min).toBe(1);
    expect(faceLimit.max).toBe(1_500_000);
    expect(faceLimit.defaultValue).toBeUndefined();

    const autoSize = tripoH31!.parameters.find(
      (parameter) => parameter.id === "autoSize",
    )!;
    expect(autoSize.type).toBe("boolean");
    expect(autoSize.defaultValue).toBeUndefined();

    expect(tripoH31!.defaultParams).toEqual({});
  });

  it("declares tripo-auto-rig as a model-to-model Card requiring exactly one model reference, no prompt, and no configurable parameters", () => {
    expect(tripoAutoRig).toBeDefined();
    expect(tripoAutoRig!.kind).toBe("model");
    expect(tripoAutoRig!.input.requiresPrompt).toBe(false);
    expect(tripoAutoRig!.input.inputMode.models).toEqual(
      expect.objectContaining({ min: 1, max: 1 }),
    );
    expect(tripoAutoRig!.input.promptModalities).toEqual(["model"]);
    // Tripo's rig route always requests biped/mixamo/glb regardless of caller input
    // (plugins/tripo/src/tripo-client.ts buildTripoRigBody) -- there is nothing to configure.
    expect(tripoAutoRig!.parameters).toEqual([]);
  });

  it("enforces the declared model-reference bound for tripo-auto-rig through the shared capability validator", () => {
    expect(validateRefs(tripoAutoRig!, { model: 1 })).toBeNull();
    expect(validateRefs(tripoAutoRig!, { model: 0 })).toMatch(
      /at least 1 reference model/i,
    );
    expect(validateRefs(tripoAutoRig!, { model: 2 })).toMatch(
      /at most 1 reference model/i,
    );
  });
});

describe("Meshy and Tripo Card catalogue shape", () => {
  it("adds exactly five model-kind Cards for these two plugin ecosystems", () => {
    const ids = [
      "meshy-6",
      "meshy-7",
      "meshy-auto-rig",
      "tripo-h3.1",
      "tripo-auto-rig",
    ];
    const found = ids.map((id) => MODEL_CARDS.find((card) => card.id === id));
    expect(found.every(Boolean)).toBe(true);
    for (const card of found) {
      expect(card!.kind).toBe("model");
    }
    // Every one of these five ids is unique within the catalogue.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not hardcode plugin executor implementation on the built-in Cards", () => {
    // Meshy and Tripo are entirely plugin-executed providers; composeExecutablePluginModelCards
    // (packages/shared-types/src/executable-plugin.ts) is what attaches their routes at catalog
    // composition time. A built-in Card here must not pre-declare a providerImplementations
    // entry naming an executorExportId -- that would be this file re-implementing the plugin's
    // own binding.
    for (const id of ["meshy-6", "meshy-7", "meshy-auto-rig", "tripo-h3.1", "tripo-auto-rig"]) {
      const card = MODEL_CARDS.find((candidate) => candidate.id === id)!;
      expect(card.providerImplementations ?? []).toEqual([]);
    }
  });

  it("derives a consistent capability profile for every new Card through the shared derivation", () => {
    for (const id of ["meshy-6", "meshy-7", "tripo-h3.1"]) {
      const card = MODEL_CARDS.find((candidate) => candidate.id === id)!;
      const cap = capability(card);
      expect(cap.outputKind).toBe("model");
      expect(cap.ref.image.max).toBe(1);
      expect(cap.ref.model.accepts).toBe(false);
    }
    for (const id of ["meshy-auto-rig", "tripo-auto-rig"]) {
      const card = MODEL_CARDS.find((candidate) => candidate.id === id)!;
      const cap = capability(card);
      expect(cap.outputKind).toBe("model");
      expect(cap.ref.model.accepts).toBe(true);
      expect(cap.ref.model.min).toBe(1);
      expect(cap.ref.model.max).toBe(1);
      expect(cap.requiresPrompt).toBe(false);
    }
  });
});
