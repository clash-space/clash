import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  createProjectAsset, GeneratorDefinitionSchema, GENERATOR_REVISIONS_CONTAINER,
  PROJECT_GENERATORS_CONTAINER, readGeneratorRevision, readProjectGenerator,
  type GeneratorDefinition, type ProjectDirectorStage,
} from "@clash/shared-types";
import {
  advanceLocalDirectorStageGenerator, attachLocalDirectorStageGeneratorToCanvas,
  copyLocalDirectorStageGeneratorActionToCanvas, createLocalDirectorStageGenerator,
  deleteLocalDirectorStageGenerator, detachLocalDirectorStageGeneratorFromCanvas,
  listLocalDirectorStageGenerators, readLocalDirectorStageGenerator,
} from "./local-director-stage-generator-product.js";

function definition(): GeneratorDefinition {
  return GeneratorDefinitionSchema.parse({
    pluginId: "clash.director", definitionId: "director-stage", version: "1.0.0",
    schemaHash: `sha256:${"4".repeat(64)}`, stateSchema: { type: "object" }, editPolicy: "advance-head",
    persistentInputs: [{ slot: "stage:media", accepts: [{ kind: "media", mediaKind: "image" }], cardinality: { minItems: 0, maxItems: null } }],
    actions: [{ id: "capture-frame", executorExportId: "capture-frame", parametersSchema: { type: "object" }, invocationInputs: [], outputs: [{ slot: "capture:output", assetType: { kind: "media", mediaKind: "image" }, cardinality: { minItems: 1, maxItems: 1 } }] }],
    projectionSurface: { id: "clash.director-stage", stateKey: "stage", mediaInputSlot: "stage:media", primaryActionId: "capture-frame" },
  });
}
function stage(overrides: Partial<ProjectDirectorStage> = {}): ProjectDirectorStage {
  return { id: "stage-1", name: "Blocking", owner: { kind: "project" }, revisionId: "unused", state: {
    schemaVersion: 1, scene: { backgroundColor: "#000000", grid: { visible: true, snap: false, size: 1 }, environmentAssetId: "environment" },
    objects: [], cameras: [], shots: [],
  }, ...overrides };
}
function seed(doc: LoroDoc) {
  expect(createProjectAsset(doc, { id: "environment", kind: "image", source: { kind: "owned", resourceId: "resource:environment" }, lifecycle: { state: "active" }, metadata: { contentType: "image/png" } }).ok).toBe(true);
}

describe("Local Director Stage native Generator product", () => {
  it("creates, reads, lists, advances with persistent media refs, rejects stale CAS, and never writes a legacy stage", () => {
    const doc = new LoroDoc(); seed(doc); const d = definition();
    const created = createLocalDirectorStageGenerator(doc, d, stage());
    expect(created.ok).toBe(true); if (!created.ok) return;
    expect(doc.getMap("directorStages").get("stage-1")).toBeUndefined();
    expect(readLocalDirectorStageGenerator(doc, d, "stage-1")).toEqual({ ok: true, stage: created.stage });
    expect(listLocalDirectorStageGenerators(doc, d)).toEqual({ ok: true, stages: [created.stage] });
    const revision = readGeneratorRevision(doc, { generatorId: "stage-1", generatorRevisionId: created.stage.revisionId });
    expect(revision?.persistentInputRefs).toEqual([{ slot: "stage:media", itemKey: "environment", target: { kind: "media", projectAssetId: "environment" } }]);
    const advanced = advanceLocalDirectorStageGenerator(doc, d, { ...created.stage, name: "Edited" });
    expect(advanced.ok).toBe(true); if (!advanced.ok) return;
    expect(advanced.stage.revisionId).not.toBe(created.stage.revisionId);
    expect(readGeneratorRevision(doc, { generatorId: "stage-1", generatorRevisionId: advanced.stage.revisionId })?.parentRevisionId).toBe(created.stage.revisionId);
    expect(advanceLocalDirectorStageGenerator(doc, d, { ...created.stage, name: "Stale" })).toMatchObject({ ok: false, error: { code: "STALE_GENERATOR_HEAD" } });
  });

  it("attaches, detaches, and copies Canvas ownership while preserving the source and native-only identity", () => {
    const doc = new LoroDoc(); seed(doc); const d = definition();
    const created = createLocalDirectorStageGenerator(doc, d, stage()); expect(created.ok).toBe(true); if (!created.ok) return;
    const attached = attachLocalDirectorStageGeneratorToCanvas(doc, d, { stageId: "stage-1", canvasId: "main", actionNodeId: "owner", position: { x: 1, y: 2 } });
    expect(attached).toMatchObject({ ok: true, stage: { owner: { kind: "canvas-action", actionNodeId: "owner" } } });
    const copied = copyLocalDirectorStageGeneratorActionToCanvas(doc, d, { sourceDirectorStageId: "stage-1", targetCanvasId: "main", newDirectorStageId: "stage-copy", newActionNodeId: "owner-copy", position: { x: 3, y: 4 } });
    expect(copied).toMatchObject({ ok: true, stage: { id: "stage-copy", owner: { kind: "canvas-action", actionNodeId: "owner-copy" } } });
    expect(readLocalDirectorStageGenerator(doc, d, "stage-1")).toMatchObject({ ok: true, stage: { owner: { kind: "canvas-action" } } });
    expect(detachLocalDirectorStageGeneratorFromCanvas(doc, d, "stage-1")).toMatchObject({ ok: true, stage: { owner: { kind: "project" } } });
    expect(doc.getMap("nodes").get("owner")).toBeUndefined();
    expect(doc.getMap("directorStages").get("stage-1")).toBeUndefined();
  });

  it("tombstones delete and fails closed for malformed facts in its own Definition family", () => {
    const doc = new LoroDoc(); seed(doc); const d = definition();
    const created = createLocalDirectorStageGenerator(doc, d, stage()); expect(created.ok).toBe(true); if (!created.ok) return;
    expect(deleteLocalDirectorStageGenerator(doc, d, { stageId: "stage-1", expectedHeadRevisionId: created.stage.revisionId, operationId: "delete-1" })).toMatchObject({ ok: true });
    expect(readLocalDirectorStageGenerator(doc, d, "stage-1")).toMatchObject({ ok: false, error: { code: "PROJECT_GENERATOR_NOT_FOUND" } });

    doc.getMap(PROJECT_GENERATORS_CONTAINER).ensureMergeableMap("broken").set("head", { revisionId: "broken-rev" });
    doc.getMap(GENERATOR_REVISIONS_CONTAINER).ensureMergeableMap("broken").set("broken-rev", {
      id: "broken-rev", generatorId: "broken", definitionRef: { pluginId: d.pluginId, definitionId: d.definitionId, version: d.version, schemaHash: d.schemaHash }, state: { stage: { name: "missing owner/state" } }, persistentInputRefs: [],
    });
    expect(listLocalDirectorStageGenerators(doc, d)).toMatchObject({ ok: false, error: { code: "GENERATOR_PROJECTION_ENVELOPE_INVALID", generatorId: "broken" } });
    expect(readProjectGenerator(doc, "broken")).not.toBeNull();
  });
});
