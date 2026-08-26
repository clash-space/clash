import { describe, expect, it } from "vitest";

import {
  createTripoProviderCases,
  selectTripoProviderCases,
} from "./tripo-provider-e2e-cases.js";

describe("Tripo provider e2e case definitions", () => {
  it("defines exactly the two sequential live cases in dependency order", async () => {
    const cases = await createTripoProviderCases();
    expect(cases.map(({ id }) => id)).toEqual([
      "tripo-h31-humanoid",
      "tripo-auto-rig",
    ]);
  });

  it("declares tripo-h31-humanoid as a text-to-model humanoid T-pose case", async () => {
    const [humanoid] = await createTripoProviderCases();
    expect(humanoid.type).toBe("model_gen");
    expect(humanoid.modelId).toBe("tripo-h3.1");
    expect(humanoid.prompt.length).toBeGreaterThan(0);
    expect(humanoid.prompt.toLowerCase()).toContain("t-pose");
    expect(humanoid.prompt.toLowerCase()).toContain("bipedal");
    expect(humanoid.refCaseIds ?? []).toEqual([]);
    expect(humanoid.params).toMatchObject({
      pbr: true,
      textureQuality: "standard",
      geometryQuality: "standard",
      autoSize: false,
    });
    expect(humanoid.expect).toEqual({
      kind: "model",
      mediaType: "model/gltf-binary",
    });
  });

  it("declares tripo-auto-rig as a promptless dependent of tripo-h31-humanoid", async () => {
    const [, autoRig] = await createTripoProviderCases();
    expect(autoRig.type).toBe("model_gen");
    expect(autoRig.modelId).toBe("tripo-auto-rig");
    expect(autoRig.prompt).toBe("");
    expect(autoRig.refCaseIds).toEqual(["tripo-h31-humanoid"]);
    expect(autoRig.expect).toEqual({
      kind: "model",
      mediaType: "model/gltf-binary",
    });
  });

  it("has no id collisions and only references known dependency ids", async () => {
    const cases = await createTripoProviderCases();
    const ids = cases.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const candidate of cases) {
      for (const dependencyId of candidate.refCaseIds ?? []) {
        expect(known.has(dependencyId)).toBe(true);
      }
    }
  });
});

describe("selectTripoProviderCases", () => {
  it("returns every case in canonical order when no targets are set", async () => {
    const cases = await createTripoProviderCases();
    expect(selectTripoProviderCases(cases, undefined)).toEqual(cases);
    expect(selectTripoProviderCases(cases, "")).toEqual(cases);
    expect(selectTripoProviderCases(cases, "   ")).toEqual(cases);
  });

  it("selects a single independent case without pulling in the other", async () => {
    const cases = await createTripoProviderCases();
    const selected = selectTripoProviderCases(cases, "tripo-h31-humanoid");
    expect(selected.map(({ id }) => id)).toEqual(["tripo-h31-humanoid"]);
  });

  it("auto-includes tripo-h31-humanoid ahead of tripo-auto-rig when only auto-rig is requested", async () => {
    const cases = await createTripoProviderCases();
    const selected = selectTripoProviderCases(cases, "tripo-auto-rig");
    expect(selected.map(({ id }) => id)).toEqual([
      "tripo-h31-humanoid",
      "tripo-auto-rig",
    ]);
  });

  it("preserves dependency-first order even when targets are requested out of order", async () => {
    const cases = await createTripoProviderCases();
    const selected = selectTripoProviderCases(
      cases,
      "tripo-auto-rig,tripo-h31-humanoid",
    );
    expect(selected.map(({ id }) => id)).toEqual([
      "tripo-h31-humanoid",
      "tripo-auto-rig",
    ]);
  });

  it("de-duplicates repeated targets", async () => {
    const cases = await createTripoProviderCases();
    const selected = selectTripoProviderCases(
      cases,
      "tripo-auto-rig,tripo-auto-rig,tripo-h31-humanoid",
    );
    expect(selected.map(({ id }) => id)).toEqual([
      "tripo-h31-humanoid",
      "tripo-auto-rig",
    ]);
  });

  it("rejects unknown target ids", async () => {
    const cases = await createTripoProviderCases();
    expect(() => selectTripoProviderCases(cases, "tripo-nonexistent")).toThrow(
      /Unknown CLASH_PROVIDER_E2E_TARGETS/,
    );
  });
});
