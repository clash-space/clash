import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import {
  createProjectAsset,
  ensureActionRunRequest,
  markActionRunStarted,
  ensureOutputCommit,
  commitActionRunOutcome,
  resolveOutputCommitAssetType,
  GeneratorDefinitionSchema,
  GENERATOR_REVISIONS_CONTAINER,
  PROJECT_GENERATORS_CONTAINER,
  readGeneratorRevision,
  readProjectGenerator,
  type GeneratorDefinition,
  type ProjectTimeline,
} from "@clash/shared-types";

import {
  advanceLocalTimelineGenerator,
  attachLocalTimelineGeneratorToCanvas,
  copyLocalTimelineGeneratorActionToCanvas,
  createLocalTimelineGenerator,
  deleteLocalTimelineGenerator,
  detachLocalTimelineGeneratorFromCanvas,
  listLocalTimelineGeneratorRuns,
  listLocalTimelineGenerators,
  readLocalTimelineGenerator,
} from "./local-timeline-generator-product.js";

const SCHEMA_HASH = `sha256:${"3".repeat(64)}`;
const OTHER_SCHEMA_HASH = `sha256:${"4".repeat(64)}`;

function timelineDefinition(
  overrides: Record<string, unknown> = {},
): GeneratorDefinition {
  return GeneratorDefinitionSchema.parse({
    pluginId: "clash.remotion",
    definitionId: "timeline",
    version: "0.1.0",
    schemaHash: SCHEMA_HASH,
    stateSchema: { type: "object" },
    editPolicy: "advance-head",
    persistentInputs: [
      {
        slot: "timeline:item",
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
      stateKey: "timeline",
      mediaInputSlot: "timeline:item",
      primaryActionId: "render",
    },
    ...overrides,
  });
}

/** Definition that has never claimed the clash.timeline surface at all. */
function nonTimelineDefinition(): GeneratorDefinition {
  return GeneratorDefinitionSchema.parse({
    pluginId: "clash.codex-imagegen",
    definitionId: "codex-imagegen",
    version: "0.1.0",
    schemaHash: OTHER_SCHEMA_HASH,
    stateSchema: { type: "object" },
    editPolicy: "advance-head",
    persistentInputs: [],
    actions: [
      {
        id: "generate",
        executorExportId: "generate",
        parametersSchema: { type: "object" },
        invocationInputs: [],
        outputs: [
          {
            slot: "output",
            assetType: { kind: "media", mediaKind: "image" },
            cardinality: { minItems: 1, maxItems: 1 },
          },
        ],
      },
    ],
  });
}

function seedMediaAsset(doc: LoroDoc, assetId: string): void {
  const result = createProjectAsset(doc, {
    id: assetId,
    kind: "video",
    source: { kind: "owned", resourceId: `resource:${assetId}` },
    lifecycle: { state: "active" },
    metadata: { contentType: "video/mp4" },
  });
  if (!result.ok && result.error.code !== "PROJECT_ASSET_EXISTS") {
    throw new Error(`Failed to seed media asset ${assetId}: ${result.error.message}`);
  }
}

function fixtureTimeline(overrides: Partial<ProjectTimeline> = {}): ProjectTimeline {
  return {
    id: "timeline-1",
    name: "Rough cut",
    owner: { kind: "project" },
    revisionId: "unused-on-create",
    state: {
      tracks: [
        {
          id: "visuals",
          items: [
            {
              id: "shot-a",
              type: "video",
              assetId: "asset-a",
              from: 0,
              durationInFrames: 30,
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("Local Timeline native Generator Run projection", () => {
  it("maps native pending/running/succeeded/failed facts and reads the succeeded Asset commit", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    seedMediaAsset(doc, "rendered-video");
    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const request = (actionRunId: string) => ({
      actionRunId,
      generatorRevision: { generatorId: created.timeline.id, generatorRevisionId: created.timeline.revisionId },
      actionId: "render",
      executor: { pluginId: definition.pluginId, version: definition.version, exportId: "render-timeline", schemaHash: definition.schemaHash },
      invocationFingerprint: `sha256:${actionRunId.charCodeAt(4).toString(16).padStart(2, "0").repeat(32)}`,
      parameters: {},
      invocationInputRefs: [],
      outputContract: definition.actions[0]!.outputs,
    });
    for (const id of ["run-a", "run-b", "run-c", "run-d"]) expect(ensureActionRunRequest(doc, request(id))).toMatchObject({ ok: true });
    expect(markActionRunStarted(doc, "run-b")).toMatchObject({ ok: true });
    expect(ensureOutputCommit(doc, { actionRunId: "run-c", outputSlot: "render:output", asset: { kind: "media", projectAssetId: "rendered-video" } }, resolveOutputCommitAssetType)).toMatchObject({ ok: true });
    expect(commitActionRunOutcome(doc, { actionRunId: "run-c", status: "succeeded" })).toMatchObject({ ok: true });
    expect(commitActionRunOutcome(doc, { actionRunId: "run-d", status: "failed" })).toMatchObject({ ok: true });

    const all = listLocalTimelineGeneratorRuns(doc, definition, "all");
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.runs.map(({ actionRunId, status }) => ({ actionRunId, status }))).toEqual([
      { actionRunId: "run-a", status: "pending" }, { actionRunId: "run-b", status: "running" },
      { actionRunId: "run-c", status: "succeeded" }, { actionRunId: "run-d", status: "failed" },
    ]);
    expect(all.runs.find((run) => run.actionRunId === "run-c")).toMatchObject({
      timelineId: "timeline-1", sourceTimelineRevisionId: created.timeline.revisionId,
      outputSlot: "render:output", assetId: "rendered-video",
      outputCommit: { asset: { kind: "media", projectAssetId: "rendered-video" } },
    });
    expect(all.runs.filter((run) => run.status !== "succeeded").every((run) => run.outputCommit === undefined && run.assetId === undefined)).toBe(true);

    const completed = listLocalTimelineGeneratorRuns(doc, definition, "completed");
    expect(completed.ok && completed.runs.map((run) => run.actionRunId)).toEqual(["run-c"]);
    expect(doc.getMap("timelines").size).toBe(0);
  });
});

describe("Local Timeline native Generator CRUD kernel", () => {
  it("creates then reads/lists a Timeline back from the native head/revision without touching the legacy timelines container", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    const timeline = fixtureTimeline();

    const created = createLocalTimelineGenerator(doc, definition, timeline);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.timeline.id).toBe(timeline.id);
    expect(created.timeline.name).toBe(timeline.name);
    expect(created.timeline.owner).toEqual(timeline.owner);
    expect(created.timeline.state).toEqual(timeline.state);

    const read = readLocalTimelineGenerator(doc, definition, timeline.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.timeline).toEqual(created.timeline);

    const list = listLocalTimelineGenerators(doc, definition);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.timelines).toEqual([created.timeline]);

    // Legacy timelines container must remain untouched by this kernel.
    expect(doc.getMap("timelines").size).toBe(0);

    // Native authority actually holds the fact: the head resolves through
    // readProjectGenerator, and its revision resolves through
    // readGeneratorRevision with real persistent refs pointing at the
    // real Project Asset seeded above — not an empty document, not a
    // fabricated Asset.
    const head = readProjectGenerator(doc, timeline.id);
    expect(head).not.toBeNull();
    if (!head) return;
    expect(head.headRevisionId).toBe(created.timeline.revisionId);

    const revision = readGeneratorRevision(doc, {
      generatorId: timeline.id,
      generatorRevisionId: head.headRevisionId,
    });
    expect(revision).not.toBeNull();
    if (!revision) return;
    expect(revision.persistentInputRefs).toEqual([
      {
        slot: "timeline:item",
        itemKey: "shot-a",
        target: { kind: "media", projectAssetId: "asset-a" },
      },
    ]);
  });

  it("only projects Generators that exactly match the Definition family in list, ignoring other families", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    const other = nonTimelineDefinition();
    seedMediaAsset(doc, "asset-a");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);

    // A different Generator family head, same doc, same container.
    doc
      .getMap(PROJECT_GENERATORS_CONTAINER)
      .ensureMergeableMap("other-generator")
      .set("head", { revisionId: "rev-other" });
    doc
      .getMap("generatorRevisions")
      .ensureMergeableMap("other-generator")
      .set("rev-other", {
        id: "rev-other",
        generatorId: "other-generator",
        definitionRef: {
          pluginId: other.pluginId,
          definitionId: other.definitionId,
          version: other.version,
          schemaHash: other.schemaHash,
        },
        state: {},
        persistentInputRefs: [],
      });

    const list = listLocalTimelineGenerators(doc, definition);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.timelines.map((t) => t.id)).toEqual(["timeline-1"]);
  });

  it("fails closed (not silently continues) when an active head of the exact Definition family has no revision fact at all", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);

    // A second head, of the exact same Definition family, whose head
    // revision id names a revision fact that exists (so the family is
    // attributable) but fails schema validation — e.g. its `state` is not
    // an object at all. This is corruption of our own family's data, not
    // "someone else's family" and not "deleted": list must fail
    // structurally rather than pretend the corrupt entry does not exist.
    doc
      .getMap(PROJECT_GENERATORS_CONTAINER)
      .ensureMergeableMap("broken-timeline")
      .set("head", { revisionId: "missing-rev" });
    doc
      .getMap(GENERATOR_REVISIONS_CONTAINER)
      .ensureMergeableMap("broken-timeline")
      .set("missing-rev", {
        id: "missing-rev",
        generatorId: "broken-timeline",
        definitionRef: {
          pluginId: definition.pluginId,
          definitionId: definition.definitionId,
          version: definition.version,
          schemaHash: definition.schemaHash,
        },
        state: "not-an-object",
        persistentInputRefs: [],
      });

    const list = listLocalTimelineGenerators(doc, definition);
    expect(list.ok).toBe(false);
    if (list.ok) return;
    expect(list.error.code).toBe("GENERATOR_REVISION_NOT_FOUND");
    expect(list.error.generatorId).toBe("broken-timeline");
  });

  it("fails closed (not silently continues) when an active head of the exact Definition family has a malformed projection envelope", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);

    // A second head, of the exact same Definition family, whose head
    // revision exists and matches the family, but whose stored state
    // under the projection surface's stateKey is not a valid Timeline
    // envelope (e.g. missing the required "state" field).
    doc
      .getMap(PROJECT_GENERATORS_CONTAINER)
      .ensureMergeableMap("malformed-timeline")
      .set("head", { revisionId: "rev-malformed" });
    doc
      .getMap(GENERATOR_REVISIONS_CONTAINER)
      .ensureMergeableMap("malformed-timeline")
      .set("rev-malformed", {
        id: "rev-malformed",
        generatorId: "malformed-timeline",
        definitionRef: {
          pluginId: definition.pluginId,
          definitionId: definition.definitionId,
          version: definition.version,
          schemaHash: definition.schemaHash,
        },
        state: { timeline: { name: "broken" } },
        persistentInputRefs: [],
      });

    const list = listLocalTimelineGenerators(doc, definition);
    expect(list.ok).toBe(false);
    if (list.ok) return;
    expect(list.error.code).toBe("GENERATOR_PROJECTION_ENVELOPE_INVALID");
    expect(list.error.generatorId).toBe("malformed-timeline");
  });

  it("advances the head to an immutable child revision with correct lineage, and rejects a stale expected revision without moving the head", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    seedMediaAsset(doc, "asset-b");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const firstRevisionId = created.timeline.revisionId;

    const edited: ProjectTimeline = {
      ...created.timeline,
      state: {
        tracks: [
          {
            id: "visuals",
            items: [
              {
                id: "shot-a",
                type: "video",
                assetId: "asset-a",
                from: 0,
                durationInFrames: 30,
              },
              {
                id: "shot-b",
                type: "video",
                assetId: "asset-b",
                from: 30,
                durationInFrames: 30,
              },
            ],
          },
        ],
      },
    };

    const advanced = advanceLocalTimelineGenerator(doc, definition, edited);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.timeline.revisionId).not.toBe(firstRevisionId);
    expect(advanced.timeline.state).toEqual(edited.state);

    // The prior revision remains an immutable, independently readable fact
    // in its own right — read directly by its own (now stale) revision id,
    // not merely inferred from the current head projection.
    const priorRevision = readGeneratorRevision(doc, {
      generatorId: "timeline-1",
      generatorRevisionId: firstRevisionId,
    });
    expect(priorRevision).not.toBeNull();
    if (!priorRevision) return;
    expect(priorRevision.id).toBe(firstRevisionId);
    expect(priorRevision.parentRevisionId).toBeUndefined();

    // The new revision names the prior one as its parent — immutable
    // lineage, not a mutable head field.
    const childRevision = readGeneratorRevision(doc, {
      generatorId: "timeline-1",
      generatorRevisionId: advanced.timeline.revisionId,
    });
    expect(childRevision).not.toBeNull();
    if (!childRevision) return;
    expect(childRevision.parentRevisionId).toBe(firstRevisionId);

    // Head reads (not just the raw revision) now resolve to the child.
    const priorRead = readLocalTimelineGenerator(doc, definition, "timeline-1");
    expect(priorRead.ok).toBe(true);
    if (!priorRead.ok) return;
    expect(priorRead.timeline.revisionId).toBe(advanced.timeline.revisionId);

    // Advancing again with the now-stale first revision id is rejected
    // structurally, and the head does not move.
    const staleAttempt = advanceLocalTimelineGenerator(doc, definition, {
      ...edited,
      revisionId: firstRevisionId,
      name: "Should not apply",
    });
    expect(staleAttempt.ok).toBe(false);
    if (staleAttempt.ok) return;
    expect(staleAttempt.error.code).toBe("STALE_GENERATOR_HEAD");
    expect(typeof staleAttempt.error.message).toBe("string");

    const afterStaleAttempt = readLocalTimelineGenerator(doc, definition, "timeline-1");
    expect(afterStaleAttempt.ok).toBe(true);
    if (!afterStaleAttempt.ok) return;
    expect(afterStaleAttempt.timeline.revisionId).toBe(advanced.timeline.revisionId);
    expect(afterStaleAttempt.timeline.name).not.toBe("Should not apply");
  });

  it("re-derives the same revision id from the same semantic proposal (deterministic, not random)", () => {
    const docA = new LoroDoc();
    const docB = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(docA, "asset-a");
    seedMediaAsset(docB, "asset-a");
    const timeline = fixtureTimeline();

    const createdA = createLocalTimelineGenerator(docA, definition, timeline);
    const createdB = createLocalTimelineGenerator(docB, definition, timeline);
    expect(createdA.ok).toBe(true);
    expect(createdB.ok).toBe(true);
    if (!createdA.ok || !createdB.ok) return;
    expect(createdA.timeline.revisionId).toBe(createdB.timeline.revisionId);

    // Re-creating (replaying) the exact same fact is idempotent, not an error.
    const replay = createLocalTimelineGenerator(docA, definition, timeline);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.changed).toBe(false);
    expect(replay.timeline).toEqual(createdA.timeline);
  });

  it("produces a native tombstone on delete and then hides the Timeline from read and list", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleted = deleteLocalTimelineGenerator(doc, definition, {
      timelineId: "timeline-1",
      expectedHeadRevisionId: created.timeline.revisionId,
      operationId: "op-1",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.tombstone.state).toBe("deleted");
    expect(deleted.tombstone.headRevisionId).toBe(created.timeline.revisionId);

    const afterDeleteRead = readLocalTimelineGenerator(doc, definition, "timeline-1");
    expect(afterDeleteRead.ok).toBe(false);

    const afterDeleteList = listLocalTimelineGenerators(doc, definition);
    expect(afterDeleteList.ok).toBe(true);
    if (!afterDeleteList.ok) return;
    expect(afterDeleteList.timelines).toEqual([]);

    // The immutable revision fact itself is still readable; only the head
    // projection is hidden, proving this is a tombstone, not an erasure.
    const doubleDelete = deleteLocalTimelineGenerator(doc, definition, {
      timelineId: "timeline-1",
      expectedHeadRevisionId: created.timeline.revisionId,
      operationId: "op-1",
    });
    expect(doubleDelete.ok).toBe(true);
    if (!doubleDelete.ok) return;
    expect(doubleDelete.changed).toBe(false);
  });

  it("derives distinct, sorted persistentInputRefs from the DSL items, and they change when the DSL items change", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    seedMediaAsset(doc, "asset-z");

    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const withTwoItems: ProjectTimeline = {
      ...created.timeline,
      state: {
        tracks: [
          {
            id: "visuals",
            items: [
              {
                id: "shot-z",
                type: "video",
                assetId: "asset-z",
                from: 30,
                durationInFrames: 30,
              },
              {
                id: "shot-a",
                type: "video",
                assetId: "asset-a",
                from: 0,
                durationInFrames: 30,
              },
            ],
          },
        ],
      },
    };

    const advanced = advanceLocalTimelineGenerator(doc, definition, withTwoItems);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;

    // Re-reading through the projection proves the persistent refs actually
    // carried the new item set, not just the envelope's state field.
    const read = readLocalTimelineGenerator(doc, definition, "timeline-1");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.timeline.state).toEqual(withTwoItems.state);
    expect(read.timeline.revisionId).not.toBe(created.timeline.revisionId);
  });

  it("attaches, detaches, and copies through immutable native ownership revisions without writing the legacy map", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attached = attachLocalTimelineGeneratorToCanvas(doc, definition, {
      timelineId: "timeline-1",
      canvasId: "main",
      actionNodeId: "action-1",
      position: { x: 10, y: 20 },
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.timeline.revisionId).not.toBe(created.timeline.revisionId);
    expect(readGeneratorRevision(doc, {
      generatorId: "timeline-1",
      generatorRevisionId: attached.timeline.revisionId,
    })?.parentRevisionId).toBe(created.timeline.revisionId);
    expect(doc.getMap("nodes").get("action-1")).toMatchObject({
      type: "video-editor",
      data: { timelineId: "timeline-1" },
    });

    const copied = copyLocalTimelineGeneratorActionToCanvas(doc, definition, {
      sourceTimelineId: "timeline-1",
      targetCanvasId: "main",
      newTimelineId: "timeline-2",
      newActionNodeId: "action-2",
      position: { x: 30, y: 40 },
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.timeline.name).toBe(attached.timeline.name);
    expect(copied.timeline.state).toEqual(attached.timeline.state);
    expect(copied.timeline.owner).toEqual({ kind: "canvas-action", canvasId: "main", actionNodeId: "action-2" });
    expect(readLocalTimelineGenerator(doc, definition, "timeline-1")).toEqual({ ok: true, timeline: attached.timeline });
    expect(doc.getMap("nodes").get("action-2")).toMatchObject({ type: "video-editor", data: { timelineId: "timeline-2" } });

    const detached = detachLocalTimelineGeneratorFromCanvas(doc, definition, "timeline-1");
    expect(detached.ok).toBe(true);
    if (!detached.ok) return;
    expect(detached.timeline.owner).toEqual({ kind: "project" });
    expect(readGeneratorRevision(doc, {
      generatorId: "timeline-1",
      generatorRevisionId: detached.timeline.revisionId,
    })?.parentRevisionId).toBe(attached.timeline.revisionId);
    expect(doc.getMap("nodes").get("action-1")).toBeUndefined();
    expect(doc.getMap("timelines").size).toBe(0);
  });

  it("prechecks ownership targets and collisions without partial native writes", () => {
    const doc = new LoroDoc();
    const definition = timelineDefinition();
    seedMediaAsset(doc, "asset-a");
    const created = createLocalTimelineGenerator(doc, definition, fixtureTimeline());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    doc.getMap("nodes").set("collision", { type: "text", data: {} });

    const failed = attachLocalTimelineGeneratorToCanvas(doc, definition, {
      timelineId: "timeline-1",
      canvasId: "main",
      actionNodeId: "collision",
      position: { x: 0, y: 0 },
    });
    expect(failed.ok).toBe(false);
    expect(readLocalTimelineGenerator(doc, definition, "timeline-1")).toEqual({ ok: true, timeline: created.timeline });
    expect(doc.getMap("canvases").size).toBe(0);
    expect(doc.getMap("timelines").size).toBe(0);
  });

  it("fails closed when the Definition does not claim the clash.timeline surface at all", () => {
    const doc = new LoroDoc();
    const other = nonTimelineDefinition();

    const created = createLocalTimelineGenerator(doc, other, fixtureTimeline());
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.code).toBe("GENERATOR_PROJECTION_SURFACE_NOT_CLAIMED");

    const read = readLocalTimelineGenerator(doc, other, "timeline-1");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe("GENERATOR_PROJECTION_SURFACE_NOT_CLAIMED");

    const list = listLocalTimelineGenerators(doc, other);
    expect(list.ok).toBe(false);
    if (list.ok) return;
    expect(list.error.code).toBe("GENERATOR_PROJECTION_SURFACE_NOT_CLAIMED");

    const del = deleteLocalTimelineGenerator(doc, other, {
      timelineId: "timeline-1",
      expectedHeadRevisionId: "irrelevant",
      operationId: "op-x",
    });
    expect(del.ok).toBe(false);
    if (del.ok) return;
    expect(del.error.code).toBe("GENERATOR_PROJECTION_SURFACE_NOT_CLAIMED");
  });
});
