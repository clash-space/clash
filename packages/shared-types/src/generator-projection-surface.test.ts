import { describe, expect, it } from "vitest";

import {
  GeneratorDefinitionSchema,
  resolveGeneratorProjectionDefinition,
} from "./index.js";

const SCHEMA_HASH =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";

function timelineDefinition(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "clash.remotion",
    definitionId: "timeline",
    version: "0.1.0",
    schemaHash: SCHEMA_HASH,
    stateSchema: { type: "object" },
    editPolicy: "advance-head",
    persistentInputs: [
      {
        slot: "media",
        accepts: [{ kind: "media", mediaKind: "video" }],
        cardinality: { minItems: 0, maxItems: null },
      },
    ],
    actions: [
      {
        id: "render",
        executorExportId: "render-timeline",
        parametersSchema: { type: "object" },
        invocationInputs: [],
        outputs: [
          {
            slot: "render:output",
            assetType: { kind: "media", mediaKind: "video" },
            cardinality: { minItems: 1, maxItems: 1 },
          },
        ],
      },
    ],
    projectionSurface: {
      id: "clash.timeline",
      stateKey: "timelineDsl",
      mediaInputSlot: "media",
      primaryActionId: "render",
    },
    ...overrides,
  };
}

describe("plugin-declared Generator projection surfaces", () => {
  it("accepts a definition whose declared surface names an existing Action and media slot", () => {
    const definition = GeneratorDefinitionSchema.parse(timelineDefinition());

    expect(definition.projectionSurface).toEqual({
      id: "clash.timeline",
      stateKey: "timelineDsl",
      mediaInputSlot: "media",
      primaryActionId: "render",
    });
  });

  it("rejects a declared surface whose primary Action is not defined", () => {
    const result = GeneratorDefinitionSchema.safeParse(
      timelineDefinition({
        projectionSurface: {
          id: "clash.timeline",
          stateKey: "timelineDsl",
          primaryActionId: "export",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "projectionSurface",
      "primaryActionId",
    ]);
  });

  it("rejects a declared surface whose media slot is not a persistent input", () => {
    const result = GeneratorDefinitionSchema.safeParse(
      timelineDefinition({
        projectionSurface: {
          id: "clash.timeline",
          stateKey: "timelineDsl",
          mediaInputSlot: "clips",
          primaryActionId: "render",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "projectionSurface",
      "mediaInputSlot",
    ]);
  });

  it("resolves the one installed definition that declares a surface", () => {
    const definition = GeneratorDefinitionSchema.parse(timelineDefinition());
    const other = GeneratorDefinitionSchema.parse(
      timelineDefinition({
        pluginId: "clash.asr",
        definitionId: "speech-analysis",
        projectionSurface: undefined,
      }),
    );

    expect(
      resolveGeneratorProjectionDefinition(
        [other, definition],
        "clash.timeline",
      ),
    ).toEqual({ ok: true, definition });
  });

  it("fails closed when no installed definition declares the surface", () => {
    expect(
      resolveGeneratorProjectionDefinition([], "clash.director-stage"),
    ).toEqual({
      ok: false,
      code: "GENERATOR_PROJECTION_SURFACE_NOT_INSTALLED",
      surfaceId: "clash.director-stage",
    });
  });

  it("fails closed when two installed definitions claim the same surface", () => {
    const first = GeneratorDefinitionSchema.parse(timelineDefinition());
    const second = GeneratorDefinitionSchema.parse(
      timelineDefinition({ pluginId: "third.party", definitionId: "clone" }),
    );

    expect(
      resolveGeneratorProjectionDefinition([first, second], "clash.timeline"),
    ).toEqual({
      ok: false,
      code: "GENERATOR_PROJECTION_SURFACE_AMBIGUOUS",
      surfaceId: "clash.timeline",
    });
  });
});
