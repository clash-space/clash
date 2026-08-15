import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import {
  createProjectAsset,
  createProjectDocumentAsset,
  createProjectGenerator,
  type GeneratorDefinition,
} from "@clash/shared-types";

import { buildLocalGeneratorActionRun } from "./local-generator-contract.js";

const definitionRef = {
  pluginId: "clash.stage",
  definitionId: "director-stage",
  version: "1.0.0",
  schemaHash: `sha256:${"a".repeat(64)}`,
} as const;

const definition: GeneratorDefinition = {
  ...definitionRef,
  stateSchema: {
    type: "object",
    properties: { scene: { type: "string", minLength: 1 } },
    required: ["scene"],
    additionalProperties: false,
  },
  editPolicy: "advance-head",
  persistentInputs: [
    {
      slot: "background",
      accepts: [{ kind: "media", mediaKind: "image" }],
      cardinality: { minItems: 1, maxItems: 1 },
    },
  ],
  actions: [
    {
      id: "render-still",
      executorExportId: "render-still",
      parametersSchema: {
        type: "object",
        properties: { exposure: { type: "number" } },
        required: ["exposure"],
        additionalProperties: false,
      },
      invocationInputs: [
        {
          slot: "script",
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
      outputs: [
        {
          slot: "image",
          assetType: { kind: "media", mediaKind: "image" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    },
  ],
};

function projectDoc(): LoroDoc {
  const doc = new LoroDoc();
  const media = createProjectAsset(doc, {
    id: "background",
    kind: "image",
    source: { kind: "owned", resourceId: "resource-background" },
    lifecycle: { state: "active" },
    metadata: { width: 1920, height: 1080, contentType: "image/png" },
  });
  if (!media.ok) throw new Error(media.error.message);
  const document = createProjectDocumentAsset(doc, {
    id: "transcript:r1",
    documentAssetId: "transcript",
    documentKind: "media.transcript",
    schemaVersion: 1,
    mutability: "versioned",
    body: {
      digest: `sha256:${"b".repeat(64)}`,
      byteLength: 100,
      contentType: "application/json",
    },
    producer: { kind: "actor", actor: { kind: "agent" } },
    sourceRefs: [],
  });
  if (!document.ok) throw new Error(document.error.message);
  const generator = createProjectGenerator(doc, {
    head: { id: "stage", headRevisionId: "stage:r1" },
    revision: {
      id: "stage:r1",
      generatorId: "stage",
      definitionRef,
      state: { scene: "courtyard" },
      persistentInputRefs: [
        {
          slot: "background",
          target: { kind: "media", projectAssetId: "background" },
        },
      ],
    },
  });
  if (!generator.ok) throw new Error(generator.error.message);
  return doc;
}

function build(
  doc = projectDoc(),
  overrides: Partial<Parameters<typeof buildLocalGeneratorActionRun>[0]> = {},
) {
  return buildLocalGeneratorActionRun({
    doc,
    definition,
    actionRunId: "run-1",
    generatorRevision: {
      generatorId: "stage",
      generatorRevisionId: "stage:r1",
    },
    actionId: "render-still",
    parameters: { exposure: 1 },
    invocationInputRefs: [
      {
        slot: "script",
        target: {
          kind: "document",
          documentAssetId: "transcript",
          revisionId: "transcript:r1",
        },
      },
    ],
    ...overrides,
  });
}

describe("Local Generator contract boundary", () => {
  it("derives the immutable Run contract and realm-free executor from the trusted definition", () => {
    const built = build();

    expect(built.action.id).toBe("render-still");
    expect(built.request).toMatchObject({
      actionRunId: "run-1",
      actionId: "render-still",
      executor: {
        pluginId: "clash.stage",
        version: "1.0.0",
        exportId: "render-still",
        schemaHash: definitionRef.schemaHash,
      },
      outputContract: definition.actions[0]!.outputs,
    });
    expect(built.request.invocationFingerprint).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(built.request.executor).not.toHaveProperty("realm");
  });

  it("keeps retry equivalence separate from intentional Run identity", () => {
    const first = build();
    const rerun = build(projectDoc(), { actionRunId: "run-2" });
    const changed = build(projectDoc(), { parameters: { exposure: 2 } });

    expect(rerun.request.actionRunId).not.toBe(first.request.actionRunId);
    expect(rerun.request.invocationFingerprint).toBe(
      first.request.invocationFingerprint,
    );
    expect(changed.request.invocationFingerprint).not.toBe(
      first.request.invocationFingerprint,
    );
  });

  it("rejects an installed definition that does not match the frozen revision", () => {
    expect(() =>
      build(projectDoc(), {
        definition: { ...definition, version: "2.0.0" },
      }),
    ).toThrow(/definition.*revision/i);
  });

  it("validates state and invocation parameters against the plugin JSON Schemas", () => {
    expect(() =>
      build(projectDoc(), { parameters: { exposure: "bright" } }),
    ).toThrow(/parameters.*number/i);

    const doc = projectDoc();
    const rawRevision = doc.getMap("generatorRevisions").get("stage") as
      { set(key: string, value: unknown): void } | undefined;
    rawRevision?.set("stage:r1", {
      id: "stage:r1",
      generatorId: "stage",
      definitionRef,
      state: {},
      persistentInputRefs: [
        {
          slot: "background",
          target: { kind: "media", projectAssetId: "background" },
        },
      ],
    });
    expect(() => build(doc)).toThrow(/state.*scene/i);
  });

  it("enforces declared slots, cardinality, exact target type, and active media", () => {
    expect(() =>
      build(projectDoc(), {
        invocationInputRefs: [
          {
            slot: "other",
            target: { kind: "media", projectAssetId: "background" },
          },
        ],
      }),
    ).toThrow(/unknown.*other/i);
    expect(() =>
      build(projectDoc(), {
        invocationInputRefs: [
          {
            slot: "script",
            target: { kind: "media", projectAssetId: "background" },
          },
        ],
      }),
    ).toThrow(/script.*type/i);
    expect(() =>
      build(projectDoc(), {
        invocationInputRefs: [
          {
            slot: "script",
            target: {
              kind: "document",
              documentAssetId: "missing",
              revisionId: "missing:r1",
            },
          },
        ],
      }),
    ).toThrow(/document.*not found/i);
  });
});
