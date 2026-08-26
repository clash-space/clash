import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";
import {
  ActionRunRequestSchema,
  ActionRunSchema,
  AssetRevisionRefSchema,
  ExecutablePluginBindingSchema,
  GeneratorActionOutputPortSchema,
  GeneratorDefinitionRefSchema,
  GeneratorDefinitionSchema,
  GeneratorInputCardinalitySchema,
  GeneratorRevisionRefSchema,
  GeneratorRevisionSchema,
  OutputCommitSchema,
  ProjectGeneratorHeadSchema,
  ProjectGeneratorSchema,
} from "./index.js";

const imageAction = {
  id: "render-still",
  executorExportId: "render-still",
  parametersSchema: { type: "object" },
  invocationInputs: [],
  outputs: [
    {
      slot: "image",
      assetType: { kind: "media", mediaKind: "image" },
      cardinality: { minItems: 1, maxItems: 1 },
    },
  ],
};

function stageDefinition(actions: unknown[]) {
  return {
    pluginId: "clash.stage",
    definitionId: "director-stage",
    version: "1.0.0",
    schemaHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    stateSchema: { type: "object" },
    editPolicy: "advance-head",
    persistentInputs: [],
    actions,
  };
}

describe("Generator v2 contracts", () => {
  it("persists only terminal Action Run outcomes apart from the immutable request", () => {
    const api = sharedTypes as typeof sharedTypes & {
      ActionRunOutcomeSchema?: {
        parse(value: unknown): unknown;
        safeParse(value: unknown): { success: boolean };
      };
    };

    expect(api.ActionRunOutcomeSchema).toBeDefined();
    expect(
      api.ActionRunOutcomeSchema!.parse({
        actionRunId: "run-123",
        status: "succeeded",
      }),
    ).toEqual({ actionRunId: "run-123", status: "succeeded" });
    expect(
      api.ActionRunOutcomeSchema!.safeParse({
        actionRunId: "run-123",
        status: "running",
      }).success,
    ).toBe(false);
  });

  it("exposes ProjectActionRun as the coarse read projection and keeps ActionRun compatible", () => {
    const api = sharedTypes as typeof sharedTypes & {
      ProjectActionRunSchema?: {
        parse(value: unknown): unknown;
      };
    };
    const value = {
      actionRunId: "run-read",
      generatorRevision: {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-17",
      },
      actionId: "render-still",
      executor: {
        pluginId: "clash.stage",
        version: "1.0.0",
        exportId: "render-still",
        schemaHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      invocationFingerprint:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      parameters: {},
      invocationInputRefs: [],
      outputContract: [
        {
          slot: "image",
          assetType: { kind: "media", mediaKind: "image" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
      status: "running",
    };

    expect(api.ProjectActionRunSchema).toBeDefined();
    expect(api.ProjectActionRunSchema!.parse(value)).toEqual(
      ActionRunSchema.parse(value),
    );
  });

  it("separates the persisted Generator head from its derived definition projection", () => {
    const api = sharedTypes as typeof sharedTypes & {
      ProjectGeneratorHeadSchema?: {
        parse(value: unknown): unknown;
      };
    };

    expect(api.ProjectGeneratorHeadSchema).toBeDefined();
    const head = api.ProjectGeneratorHeadSchema!.parse({
      id: "stage-1",
      headRevisionId: "stage-rev-17",
    });
    const projected = ProjectGeneratorSchema.parse({
      ...head,
      definitionRef: {
        pluginId: "clash.stage",
        definitionId: "director-stage",
        version: "1.0.0",
        schemaHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    expect(head).not.toHaveProperty("definitionRef");
    expect(projected.definitionRef.definitionId).toBe("director-stage");
  });

  it("uses the installed Plugin binding SHA-256 dialect in definition refs", () => {
    const binding = ExecutablePluginBindingSchema.parse({
      pluginId: "clash.stage",
      version: "1.0.0",
      exportId: "director-stage",
      schemaHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(
      GeneratorDefinitionRefSchema.parse({
        pluginId: binding.pluginId,
        definitionId: binding.exportId,
        version: binding.version,
        schemaHash: binding.schemaHash,
      }).schemaHash,
    ).toBe(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("registers multiple fixed-output actions on one Generator definition", () => {
    const definition = GeneratorDefinitionSchema.parse(
      stageDefinition([
        imageAction,
        {
          id: "render-video",
          executorExportId: "renderVideo",
          parametersSchema: { type: "object" },
          invocationInputs: [],
          outputs: [
            {
              slot: "video",
              assetType: { kind: "media", mediaKind: "video" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ]),
    );

    expect(definition.actions.map(({ id }) => id)).toEqual([
      "render-still",
      "render-video",
    ]);
  });

  it("represents a materialized badge as a fork-on-edit Generator", () => {
    expect(
      GeneratorDefinitionSchema.parse({
        pluginId: "clash.canvas",
        definitionId: "model-generator",
        version: "1.0.0",
        schemaHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        stateSchema: { type: "object" },
        editPolicy: "fork-when-materialized",
        persistentInputs: [],
        actions: [
          {
            id: "generate",
            executorExportId: "generate",
            parametersSchema: { type: "object" },
            invocationInputs: [],
            outputs: [
              {
                slot: "image",
                assetType: { kind: "media", mediaKind: "image" },
                cardinality: { minItems: 1, maxItems: 1 },
              },
            ],
          },
        ],
      }).editPolicy,
    ).toBe("fork-when-materialized");
  });

  it("rejects ambiguous duplicate action ids within one definition", () => {
    const result = GeneratorDefinitionSchema.safeParse(
      stageDefinition([
        imageAction,
        { ...imageAction, executorExportId: "renderStillAgain" },
      ]),
    );

    expect(result.success).toBe(false);
  });

  it("pins a Project Generator revision to its definition and exact persistent inputs", () => {
    const definitionRef = {
      pluginId: "clash.stage",
      definitionId: "director-stage",
      version: "1.0.0",
      schemaHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const media = AssetRevisionRefSchema.parse({
      kind: "media",
      projectAssetId: "asset-background",
    });
    const transcript = AssetRevisionRefSchema.parse({
      kind: "document",
      documentAssetId: "transcript-main",
      revisionId: "txrev-7",
    });
    const projectGenerator = ProjectGeneratorSchema.parse({
      id: "stage-1",
      headRevisionId: "stage-rev-17",
      definitionRef,
    });
    const revision = GeneratorRevisionSchema.parse({
      id: "stage-rev-17",
      generatorId: "stage-1",
      definitionRef,
      parentRevisionId: "stage-rev-16",
      state: { scene: "rooftop", camera: { lens: 35 } },
      persistentInputRefs: [
        { slot: "background", target: media },
        { slot: "script", target: transcript },
      ],
    });

    expect(projectGenerator.headRevisionId).toBe("stage-rev-17");
    expect(projectGenerator.definitionRef).toEqual(definitionRef);
    expect(
      GeneratorRevisionRefSchema.parse({
        generatorId: revision.generatorId,
        generatorRevisionId: revision.id,
      }),
    ).toEqual({
      generatorId: "stage-1",
      generatorRevisionId: "stage-rev-17",
    });
    expect(revision.persistentInputRefs).toEqual([
      {
        slot: "background",
        target: { kind: "media", projectAssetId: "asset-background" },
      },
      {
        slot: "script",
        target: {
          kind: "document",
          documentAssetId: "transcript-main",
          revisionId: "txrev-7",
        },
      },
    ]);
  });

  it("derives the Generator definition from the immutable head revision", () => {
    expect(
      ProjectGeneratorHeadSchema.safeParse({
        id: "stage-1",
        headRevisionId: "stage-rev-17",
        definitionRef: {
          pluginId: "clash.stage",
          definitionId: "director-stage",
          version: "1.0.0",
          schemaHash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps same-Generator ancestry separate from a cross-Generator COW origin", () => {
    const fork = GeneratorRevisionSchema.parse({
      id: "badge-copy-rev-1",
      generatorId: "badge-copy",
      definitionRef: {
        pluginId: "clash.canvas",
        definitionId: "model-generator",
        version: "1.0.0",
        schemaHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      forkedFrom: {
        generatorId: "badge-original",
        generatorRevisionId: "badge-original-rev-7",
      },
      state: { prompt: "keep the lighting" },
      persistentInputRefs: [],
    });

    expect(fork.parentRevisionId).toBeUndefined();
    expect(fork.forkedFrom).toEqual({
      generatorId: "badge-original",
      generatorRevisionId: "badge-original-rev-7",
    });
    expect(
      GeneratorRevisionSchema.safeParse({
        ...fork,
        forkedFrom: {
          generatorId: "badge-copy",
          generatorRevisionId: "badge-copy-rev-0",
        },
      }).success,
    ).toBe(false);
  });

  it("declares typed document outputs and invocation-only Asset inputs", () => {
    const asr = GeneratorDefinitionSchema.parse({
      pluginId: "clash.asr",
      definitionId: "speech-analysis",
      version: "1.0.0",
      schemaHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      stateSchema: { type: "object" },
      editPolicy: "advance-head",
      persistentInputs: [],
      actions: [
        {
          id: "transcribe",
          executorExportId: "transcribe",
          parametersSchema: { type: "object" },
          invocationInputs: [
            {
              slot: "source",
              accepts: [
                { kind: "media", mediaKind: "audio" },
                { kind: "media", mediaKind: "video" },
              ],
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
          outputs: [
            {
              slot: "transcript",
              assetType: {
                kind: "document",
                documentKind: "media.transcript",
                schemaVersion: 1,
              },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ],
    });

    expect(asr.actions[0]?.invocationInputs[0]).toEqual({
      slot: "source",
      accepts: [
        { kind: "media", mediaKind: "audio" },
        { kind: "media", mediaKind: "video" },
      ],
      cardinality: { minItems: 1, maxItems: 1 },
    });
    expect(asr.actions[0]?.outputs[0]?.assetType).toEqual({
      kind: "document",
      documentKind: "media.transcript",
      schemaVersion: 1,
    });
  });

  it("keeps one Action Run identity independent from its output commit", () => {
    const request = ActionRunRequestSchema.parse({
      actionRunId: "run-123",
      generatorRevision: {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-17",
      },
      actionId: "render-video",
      executor: {
        pluginId: "clash.stage",
        version: "1.0.0",
        exportId: "renderVideo",
        schemaHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      invocationFingerprint:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      parameters: { durationSeconds: 5 },
      invocationInputRefs: [
        {
          slot: "reference",
          target: { kind: "media", projectAssetId: "asset-reference" },
        },
      ],
      outputContract: [
        {
          slot: "video",
          assetType: { kind: "media", mediaKind: "video" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    });
    const run = ActionRunSchema.parse({ ...request, status: "pending" });
    const commit = OutputCommitSchema.parse({
      actionRunId: "run-123",
      outputSlot: "video",
      asset: { kind: "media", projectAssetId: "asset-result" },
    });

    expect(request).not.toHaveProperty("status");
    expect(request.executor).toEqual({
      pluginId: "clash.stage",
      version: "1.0.0",
      exportId: "renderVideo",
      schemaHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(
      ActionRunRequestSchema.safeParse({
        ...request,
        executor: { ...request.executor, realm: "bundled-module" },
      }).success,
    ).toBe(false);
    expect(run).not.toHaveProperty("outputSlot");
    expect(commit).toEqual({
      actionRunId: "run-123",
      outputSlot: "video",
      asset: { kind: "media", projectAssetId: "asset-result" },
    });
  });

  it("keeps output cardinality explicit in the port shape", () => {
    expect(
      GeneratorActionOutputPortSchema.parse({
        slot: "shots",
        assetType: { kind: "media", mediaKind: "video" },
        cardinality: { minItems: 1, maxItems: 3 },
      }),
    ).toEqual({
      slot: "shots",
      assetType: { kind: "media", mediaKind: "video" },
      cardinality: { minItems: 1, maxItems: 3 },
    });
  });

  it("models exact, bounded, and unbounded port cardinalities without losing limits", () => {
    expect(
      GeneratorInputCardinalitySchema.parse({
        minItems: 1,
        maxItems: 3,
      }),
    ).toEqual({ minItems: 1, maxItems: 3 });
    expect(
      GeneratorInputCardinalitySchema.parse({
        minItems: 0,
        maxItems: null,
      }),
    ).toEqual({ minItems: 0, maxItems: null });

    for (const cardinality of [
      { minItems: -1, maxItems: 1 },
      { minItems: 0, maxItems: 0 },
      { minItems: 3, maxItems: 2 },
      { minItems: 1, maxItems: 1, legacy: "one" },
    ]) {
      expect(
        GeneratorInputCardinalitySchema.safeParse(cardinality).success,
      ).toBe(false);
    }
  });

  it("rejects collection outputs while allowing independent singular ports", () => {
    const collectionResult = GeneratorDefinitionSchema.safeParse(
      stageDefinition([
        {
          ...imageAction,
          outputs: [
            {
              slot: "images",
              assetType: { kind: "media", mediaKind: "image" },
              cardinality: { minItems: 1, maxItems: null },
            },
          ],
        },
      ]),
    );
    const multiplePortsResult = GeneratorDefinitionSchema.safeParse(
      stageDefinition([
        {
          ...imageAction,
          outputs: [
            imageAction.outputs[0],
            {
              slot: "poster",
              assetType: { kind: "media", mediaKind: "image" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ]),
    );

    expect(collectionResult.success).toBe(false);
    expect(multiplePortsResult.success).toBe(true);
  });

  it("accepts model as a peer media kind in Generator inputs, outputs, and source declarations", () => {
    const definition = GeneratorDefinitionSchema.parse(
      stageDefinition([
        {
          id: "retarget",
          executorExportId: "retarget-model",
          parametersSchema: { type: "object" },
          invocationInputs: [
            {
              slot: "source-model",
              accepts: [{ kind: "media", mediaKind: "model" }],
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
          outputs: [
            {
              slot: "rigged-model",
              assetType: { kind: "media", mediaKind: "model" },
              sourceMediaKinds: ["model"],
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ]),
    );

    expect(definition.actions[0]).toMatchObject({
      invocationInputs: [
        { slot: "source-model", accepts: [{ kind: "media", mediaKind: "model" }] },
      ],
      outputs: [
        {
          slot: "rigged-model",
          assetType: { kind: "media", mediaKind: "model" },
          sourceMediaKinds: ["model"],
        },
      ],
    });
  });

  it("pins an upstream Generator revision as a persistent or invocation input", () => {
    const target = {
      generatorId: "stage-1",
      generatorRevisionId: "stage-rev-17",
    };
    const revision = GeneratorRevisionSchema.parse({
      id: "video-rev-4",
      generatorId: "video-generator-1",
      definitionRef: {
        pluginId: "clash.video",
        definitionId: "video-generator",
        version: "1.0.0",
        schemaHash:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
      state: { prompt: "orbit around the scene" },
      persistentInputRefs: [{ slot: "stage", target }],
    });
    const run = ActionRunRequestSchema.parse({
      actionRunId: "run-video-4",
      generatorRevision: {
        generatorId: "video-generator-1",
        generatorRevisionId: "video-rev-4",
      },
      actionId: "generate",
      executor: {
        pluginId: "clash.video",
        version: "1.0.0",
        exportId: "generate",
        schemaHash:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
      invocationFingerprint:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      parameters: {},
      invocationInputRefs: [{ slot: "stage", target }],
      outputContract: [
        {
          slot: "video",
          assetType: { kind: "media", mediaKind: "video" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    });

    expect(revision.persistentInputRefs[0]?.target).toEqual(target);
    expect(run.invocationInputRefs[0]?.target).toEqual(target);
  });

  it("rejects duplicate input slots within one Action definition", () => {
    const result = GeneratorDefinitionSchema.safeParse(
      stageDefinition([
        {
          ...imageAction,
          invocationInputs: [
            {
              slot: "source",
              accepts: [{ kind: "media", mediaKind: "image" }],
              cardinality: { minItems: 1, maxItems: 1 },
            },
            {
              slot: "source",
              accepts: [{ kind: "media", mediaKind: "video" }],
              cardinality: { minItems: 0, maxItems: 1 },
            },
          ],
        },
      ]),
    );

    expect(result.success).toBe(false);
  });

  it("keeps the execution realm out of semantic Generator identity", () => {
    expect(
      GeneratorDefinitionSchema.safeParse({
        ...stageDefinition([imageAction]),
        executionRealm: "host-process",
      }).success,
    ).toBe(false);
  });

  it("declares a revision-bound upstream Generator family as a persistent input", () => {
    const definition = GeneratorDefinitionSchema.parse({
      ...stageDefinition([imageAction]),
      pluginId: "clash.video",
      definitionId: "video-generator",
      persistentInputs: [
        {
          slot: "stage",
          accepts: [
            {
              kind: "generator",
              pluginId: "clash.stage",
              definitionId: "director-stage",
            },
          ],
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    });

    expect(definition.persistentInputs).toEqual([
      {
        slot: "stage",
        accepts: [
          {
            kind: "generator",
            pluginId: "clash.stage",
            definitionId: "director-stage",
          },
        ],
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ]);
  });

  it("rejects duplicate persistent input slots within one Generator definition", () => {
    const result = GeneratorDefinitionSchema.safeParse({
      ...stageDefinition([imageAction]),
      persistentInputs: [
        {
          slot: "source",
          accepts: [{ kind: "media", mediaKind: "image" }],
          cardinality: { minItems: 1, maxItems: 1 },
        },
        {
          slot: "source",
          accepts: [
            {
              kind: "document",
              documentKind: "media.transcript",
              schemaVersion: 1,
            },
          ],
          cardinality: { minItems: 0, maxItems: 1 },
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
