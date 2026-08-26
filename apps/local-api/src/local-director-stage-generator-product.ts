import { createHash } from "node:crypto";

import type { LoroDoc } from "loro-crdt";

import {
  advanceProjectGeneratorHead,
  createProjectGenerator,
  deleteProjectGenerator,
  projectDirectorStageFromGeneratorRevision,
  projectDirectorStageToGeneratorRevisionState,
  readGeneratorRevision,
  readProjectGenerator,
  GENERATOR_REVISIONS_CONTAINER,
  GENERATOR_ACTION_RUNS_CONTAINER,
  PROJECT_GENERATORS_CONTAINER,
  readProjectActionRun,
  readOutputCommit,
  type ActionRunStatus,
  type OutputCommit,
  type GeneratorDefinition,
  type GeneratorDefinitionRef,
  type GeneratorInputRef,
  type GeneratorRevision,
  type ProjectGeneratorTombstone,
  type ProjectDirectorStage,
  Canvas,
  DEFAULT_CANVAS_ID,
  ensureProjectCanvas,
} from "@clash/shared-types";

import { validateLocalGeneratorRevisionContract } from "./local-generator-contract.js";

/**
 * Local Host CRUD kernel for the DirectorStage legacy surface, projected entirely
 * onto native Project Generator identity, immutable revisions, and the
 * `clash.director-stage` compatibility surface. This module never touches the
 * legacy `stages` Loro container; it reads and writes only through the
 * native Generator authority (`projectGenerators` / `generatorRevisions`).
 */

export interface LocalDirectorStageGeneratorError {
  code: string;
  message: string;
  generatorId?: string;
  generatorRevisionId?: string;
}

export type CreateLocalDirectorStageGeneratorResult =
  | { ok: true; stage: ProjectDirectorStage; changed: boolean }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export type ReadLocalDirectorStageGeneratorResult =
  | { ok: true; stage: ProjectDirectorStage }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export type ListLocalDirectorStageGeneratorsResult =
  | { ok: true; stages: ProjectDirectorStage[] }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export interface LocalDirectorStageGeneratorRun {
  actionRunId: string;
  stageId: string;
  sourceDirectorStageRevisionId: string;
  status: ActionRunStatus;
  outputSlot: string;
  outputCommit?: OutputCommit;
  assetId?: string;
}

export type ListLocalDirectorStageGeneratorRunsResult =
  | { ok: true; runs: LocalDirectorStageGeneratorRun[] }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export type AdvanceLocalDirectorStageGeneratorResult =
  | { ok: true; stage: ProjectDirectorStage; changed: boolean }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export type DeleteLocalDirectorStageGeneratorResult =
  | { ok: true; tombstone: ProjectGeneratorTombstone; changed: boolean }
  | { ok: false; error: LocalDirectorStageGeneratorError };

export type OwnLocalDirectorStageGeneratorResult =
  | { ok: true; stage: ProjectDirectorStage }
  | { ok: false; error: LocalDirectorStageGeneratorError };

function ownershipError(code: string, message: string, generatorId?: string): OwnLocalDirectorStageGeneratorResult {
  return { ok: false, error: { code, message, generatorId } };
}

function stageIdFromActionNode(raw: unknown): string | null {
  if (!isRecord(raw) || raw.type !== "director-stage" || !isRecord(raw.data)) return null;
  return typeof raw.data.stageId === "string" ? raw.data.stageId : null;
}

function definitionRefOf(definition: GeneratorDefinition): GeneratorDefinitionRef {
  return {
    pluginId: definition.pluginId,
    definitionId: definition.definitionId,
    version: definition.version,
    schemaHash: definition.schemaHash,
  };
}

function definitionRefsMatch(
  a: GeneratorDefinitionRef,
  b: GeneratorDefinitionRef,
): boolean {
  return (
    a.pluginId === b.pluginId &&
    a.definitionId === b.definitionId &&
    a.version === b.version &&
    a.schemaHash === b.schemaHash
  );
}

function isLoroLikeMap(
  value: unknown,
): value is { get(key: string): unknown } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { get?: unknown }).get === "function",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tolerant, schema-independent peek at the raw stored revision's
 * `definitionRef`, used only to decide whether an active head whose
 * revision fact is missing or malformed structurally belongs to this exact
 * Definition family (and must fail closed) or to some other family /
 * genuinely absent fact (which list is entitled to ignore). This never
 * substitutes for `readGeneratorRevision`'s real, schema-validated read.
 */
function rawStoredRevisionDefinitionRef(
  doc: LoroDoc,
  generatorId: string,
  generatorRevisionId: string,
): GeneratorDefinitionRef | null {
  const revisionsForGenerator = doc
    .getMap(GENERATOR_REVISIONS_CONTAINER)
    .get(generatorId);
  if (!isLoroLikeMap(revisionsForGenerator)) return null;
  const raw = revisionsForGenerator.get(generatorRevisionId);
  if (!isRecord(raw) || !isRecord(raw.definitionRef)) return null;
  const ref = raw.definitionRef;
  if (
    typeof ref.pluginId !== "string" ||
    typeof ref.definitionId !== "string" ||
    typeof ref.version !== "string" ||
    typeof ref.schemaHash !== "string"
  ) {
    return null;
  }
  return {
    pluginId: ref.pluginId,
    definitionId: ref.definitionId,
    version: ref.version,
    schemaHash: ref.schemaHash,
  };
}

/**
 * Fail closed before touching any native Generator identity when the
 * installed Definition does not claim the `clash.director-stage` compatibility
 * surface at all. Callers that reach here with a Definition that never
 * claimed the surface would otherwise silently read/write an unrelated
 * Generator family's facts.
 */
function requireDirectorStageSurface(
  definition: GeneratorDefinition,
): { ok: true } | { ok: false; error: LocalDirectorStageGeneratorError } {
  const surface = definition.projectionSurface;
  if (!surface || surface.id !== "clash.director-stage") {
    return {
      ok: false,
      error: {
        code: "GENERATOR_PROJECTION_SURFACE_NOT_CLAIMED",
        message:
          "Definition does not claim the clash.director-stage projection surface.",
      },
    };
  }
  if (!surface.mediaInputSlot) {
    return {
      ok: false,
      error: {
        code: "GENERATOR_PROJECTION_SURFACE_MISSING_MEDIA_SLOT",
        message:
          "Projection surface does not declare a persistent media input slot.",
      },
    };
  }
  return { ok: true };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministically derive the next immutable Generator revision id from the
 * exact semantic facts that revision proposes: the Generator identity, the
 * Definition provenance, the full projected state, the persistent media
 * refs it carries, and its parent lineage. The same proposal from any peer
 * always names the same revision id; nothing here is a mutable head or a
 * random id.
 */
function proposeRevisionId(input: {
  generatorId: string;
  definitionRef: GeneratorDefinitionRef;
  state: Record<string, unknown>;
  persistentInputRefs: readonly GeneratorInputRef[];
  parentRevisionId: string | null;
}): string {
  const canonical = {
    generatorId: input.generatorId,
    definitionRef: input.definitionRef,
    state: input.state,
    persistentInputRefs: input.persistentInputRefs,
    parentRevisionId: input.parentRevisionId,
  };
  const digest = createHash("sha256")
    .update(canonicalJson(canonical))
    .digest("hex");
  return `genrev_sha256:${digest}`;
}

function contractViolationError(error: unknown): LocalDirectorStageGeneratorError {
  return {
    code: "GENERATOR_CONTRACT_VIOLATION",
    message: error instanceof Error ? error.message : String(error),
  };
}

function buildProposedRevision(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  stage: ProjectDirectorStage,
  parentRevisionId: string | undefined,
):
  | { ok: true; revision: GeneratorRevision }
  | { ok: false; error: LocalDirectorStageGeneratorError } {
  const projected = projectDirectorStageToGeneratorRevisionState(
    stage,
    definition,
  );
  if (!projected.ok) {
    return {
      ok: false,
      error: { code: projected.code, message: projected.message },
    };
  }
  const definitionRef = definitionRefOf(definition);
  const revisionId = proposeRevisionId({
    generatorId: stage.id,
    definitionRef,
    state: projected.state,
    persistentInputRefs: projected.persistentInputRefs,
    parentRevisionId: parentRevisionId ?? null,
  });
  const proposed: GeneratorRevision = {
    id: revisionId,
    generatorId: stage.id,
    definitionRef,
    state: projected.state,
    persistentInputRefs: projected.persistentInputRefs,
    ...(parentRevisionId ? { parentRevisionId } : {}),
  };
  try {
    const validated = validateLocalGeneratorRevisionContract({
      doc,
      definition,
      revision: proposed,
    });
    return { ok: true, revision: validated };
  } catch (error) {
    return { ok: false, error: contractViolationError(error) };
  }
}

/**
 * Create the native Generator identity for a fresh DirectorStage. The genesis
 * revision has no parent; its id is a pure function of the Definition
 * provenance, the projected state, and the persistent media refs derived
 * from the DirectorStage DSL.
 */
export function createLocalDirectorStageGenerator(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  stage: ProjectDirectorStage,
): CreateLocalDirectorStageGeneratorResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;

  const proposal = buildProposedRevision(doc, definition, stage, undefined);
  if (!proposal.ok) return proposal;

  const result = createProjectGenerator(doc, {
    head: { id: stage.id, headRevisionId: proposal.revision.id },
    revision: proposal.revision,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const projectedBack = projectDirectorStageFromGeneratorRevision(
    { head: result.generator, revision: result.revision },
    definition,
  );
  if (!projectedBack.ok) {
    return {
      ok: false,
      error: {
        code: projectedBack.code,
        message:
          "Failed to project the created native Generator back to a DirectorStage.",
        generatorId: projectedBack.generatorId,
        generatorRevisionId: projectedBack.revisionId,
      },
    };
  }
  return { ok: true, stage: projectedBack.stage, changed: result.changed };
}

/**
 * Read a DirectorStage projection purely from the native Generator head and its
 * immutable revision. Fails closed (not-found) if the head belongs to a
 * different Definition family.
 */
export function readLocalDirectorStageGenerator(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  stageId: string,
): ReadLocalDirectorStageGeneratorResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;

  const head = readProjectGenerator(doc, stageId);
  if (!head || !definitionRefsMatch(head.definitionRef, definitionRefOf(definition))) {
    return {
      ok: false,
      error: {
        code: "PROJECT_GENERATOR_NOT_FOUND",
        message: `Project Generator ${stageId} not found.`,
        generatorId: stageId,
      },
    };
  }
  const revision = readGeneratorRevision(doc, {
    generatorId: stageId,
    generatorRevisionId: head.headRevisionId,
  });
  if (!revision) {
    return {
      ok: false,
      error: {
        code: "GENERATOR_REVISION_NOT_FOUND",
        message: `Generator revision ${stageId}/${head.headRevisionId} not found.`,
        generatorId: stageId,
        generatorRevisionId: head.headRevisionId,
      },
    };
  }
  const projected = projectDirectorStageFromGeneratorRevision(
    { head, revision },
    definition,
  );
  if (!projected.ok) {
    return {
      ok: false,
      error: {
        code: projected.code,
        message: "Failed to project the native Generator to a DirectorStage.",
        generatorId: projected.generatorId,
        generatorRevisionId: projected.revisionId,
      },
    };
  }
  return { ok: true, stage: projected.stage };
}

/**
 * Scan native Generator heads and project only the ones that are active
 * (not tombstoned) and belong exactly to the given Definition family. Never
 * reads the legacy `stages` container.
 *
 * An active head whose `headRevisionId` names this exact Definition family
 * (per the raw stored revision's `definitionRef`) but whose revision fact is
 * missing or fails to project fails the whole call closed with a
 * structured error — that is corruption of our own family's data, not
 * another family's business, so it must never be silently skipped.
 */
export function listLocalDirectorStageGeneratorRuns(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  status: "completed" | "all",
): ListLocalDirectorStageGeneratorRunsResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;
  const actionId = definition.projectionSurface!.primaryActionId;
  const action = definition.actions.find((candidate) => candidate.id === actionId);
  const output = action?.outputs[0];
  if (!action || !output) {
    return { ok: false, error: { code: "GENERATOR_PROJECTION_SURFACE_INVALID", message: "DirectorStage projection surface has no valid primary Action output." } };
  }

  const family = definitionRefOf(definition);
  const runs: LocalDirectorStageGeneratorRun[] = [];
  for (const [actionRunId, rawFields] of doc.getMap(GENERATOR_ACTION_RUNS_CONTAINER).entries()) {
    if (!isLoroLikeMap(rawFields)) continue;
    const rawRequest = rawFields.get("request");
    const rawRevision = isRecord(rawRequest) && isRecord(rawRequest.generatorRevision)
      ? rawRequest.generatorRevision : null;
    const generatorId = rawRevision && typeof rawRevision.generatorId === "string" ? rawRevision.generatorId : null;
    const revisionId = rawRevision && typeof rawRevision.generatorRevisionId === "string" ? rawRevision.generatorRevisionId : null;
    if (!generatorId || !revisionId) continue;
    const rawFamily = rawStoredRevisionDefinitionRef(doc, generatorId, revisionId);
    if (!rawFamily || !definitionRefsMatch(rawFamily, family)) continue;

    const revision = readGeneratorRevision(doc, { generatorId, generatorRevisionId: revisionId });
    const run = readProjectActionRun(doc, actionRunId);
    if (!revision || !run) {
      return { ok: false, error: { code: "INVALID_ACTION_RUN", message: `Action Run ${actionRunId} or its Generator revision is malformed.`, generatorId, generatorRevisionId: revisionId } };
    }
    if (run.actionId !== actionId) continue;
    if (status === "completed" && run.status !== "succeeded") continue;

    const projected: LocalDirectorStageGeneratorRun = {
      actionRunId: run.actionRunId,
      stageId: revision.generatorId,
      sourceDirectorStageRevisionId: revision.id,
      status: run.status,
      outputSlot: output.slot,
    };
    if (run.status === "succeeded") {
      const commit = readOutputCommit(doc, { actionRunId: run.actionRunId, outputSlot: output.slot });
      if (!commit) {
        return { ok: false, error: { code: "REQUIRED_OUTPUT_NOT_COMMITTED", message: `Succeeded Action Run ${run.actionRunId} has no required output commit.`, generatorId, generatorRevisionId: revisionId } };
      }
      projected.outputCommit = commit;
      projected.assetId = commit.asset.kind === "media" ? commit.asset.projectAssetId : commit.asset.documentAssetId;
    }
    runs.push(projected);
  }
  runs.sort((a, b) => a.actionRunId.localeCompare(b.actionRunId));
  return { ok: true, runs };
}

export function listLocalDirectorStageGenerators(
  doc: LoroDoc,
  definition: GeneratorDefinition,
): ListLocalDirectorStageGeneratorsResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;

  const definitionRef = definitionRefOf(definition);
  const stages: ProjectDirectorStage[] = [];
  const container = doc.getMap(PROJECT_GENERATORS_CONTAINER);
  for (const [generatorId] of container.entries()) {
    const rawEntry = container.get(generatorId);
    if (!isLoroLikeMap(rawEntry)) continue;
    if (rawEntry.get("terminal") !== undefined) continue; // tombstoned
    const rawHead = rawEntry.get("head");
    const rawHeadRevisionId = isRecord(rawHead) ? rawHead.revisionId : undefined;
    if (typeof rawHeadRevisionId !== "string" || !rawHeadRevisionId.trim()) {
      continue; // structurally not even a head; nothing to attribute
    }

    const rawFamilyRef = rawStoredRevisionDefinitionRef(
      doc,
      generatorId,
      rawHeadRevisionId,
    );
    const claimsOurFamily =
      rawFamilyRef !== null && definitionRefsMatch(rawFamilyRef, definitionRef);

    const head = readProjectGenerator(doc, generatorId);
    if (!head) {
      if (claimsOurFamily) {
        return {
          ok: false,
          error: {
            code: "GENERATOR_REVISION_NOT_FOUND",
            message: `Generator revision ${generatorId}/${rawHeadRevisionId} not found.`,
            generatorId,
            generatorRevisionId: rawHeadRevisionId,
          },
        };
      }
      continue; // not our family, or genuinely not attributable to any family
    }
    if (!definitionRefsMatch(head.definitionRef, definitionRef)) continue;

    const revision = readGeneratorRevision(doc, {
      generatorId: head.id,
      generatorRevisionId: head.headRevisionId,
    });
    if (!revision) {
      return {
        ok: false,
        error: {
          code: "GENERATOR_REVISION_NOT_FOUND",
          message: `Generator revision ${head.id}/${head.headRevisionId} not found.`,
          generatorId: head.id,
          generatorRevisionId: head.headRevisionId,
        },
      };
    }
    const projected = projectDirectorStageFromGeneratorRevision(
      { head, revision },
      definition,
    );
    if (!projected.ok) {
      return {
        ok: false,
        error: {
          code: projected.code,
          message: "Failed to project the native Generator to a DirectorStage.",
          generatorId: projected.generatorId,
          generatorRevisionId: projected.revisionId,
        },
      };
    }
    stages.push(projected.stage);
  }
  stages.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, stages };
}

/**
 * Advance the native Generator head to an immutable child revision derived
 * from the edited DirectorStage. `stage.revisionId` must name the exact head
 * revision the caller last read; a stale value is rejected with a
 * structured error and the head is left unchanged.
 */
export function advanceLocalDirectorStageGenerator(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  stage: ProjectDirectorStage,
): AdvanceLocalDirectorStageGeneratorResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;

  const expectedHeadRevisionId = stage.revisionId;
  if (!expectedHeadRevisionId) {
    return {
      ok: false,
      error: {
        code: "INVALID_PROJECT_GENERATOR",
        message: "Advancing a DirectorStage requires the expected head revision id.",
        generatorId: stage.id,
      },
    };
  }

  const proposal = buildProposedRevision(
    doc,
    definition,
    stage,
    expectedHeadRevisionId,
  );
  if (!proposal.ok) return proposal;

  const result = advanceProjectGeneratorHead(doc, {
    generatorId: stage.id,
    expectedHeadRevisionId,
    revision: proposal.revision,
    editPolicy: definition.editPolicy,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const projectedBack = projectDirectorStageFromGeneratorRevision(
    { head: result.generator, revision: result.revision },
    definition,
  );
  if (!projectedBack.ok) {
    return {
      ok: false,
      error: {
        code: projectedBack.code,
        message:
          "Failed to project the advanced native Generator back to a DirectorStage.",
        generatorId: projectedBack.generatorId,
        generatorRevisionId: projectedBack.revisionId,
      },
    };
  }
  return { ok: true, stage: projectedBack.stage, changed: result.changed };
}

/**
 * Tombstone the native Generator identity behind a DirectorStage. Fails closed
 * if the current head belongs to a different Definition family.
 */
/** Attach a standalone native DirectorStage by advancing ownership and creating its Action node. */
export function attachLocalDirectorStageGeneratorToCanvas(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  input: {
    stageId: string;
    canvasId: string;
    actionNodeId: string;
    position: { x: number; y: number };
  },
): OwnLocalDirectorStageGeneratorResult {
  const read = readLocalDirectorStageGenerator(doc, definition, input.stageId);
  if (!read.ok) return read;
  if (read.stage.owner.kind !== "project") {
    return ownershipError("DIRECTOR_STAGE_ALREADY_CANVAS_OWNED", `DirectorStage ${input.stageId} is already owned by Canvas ${read.stage.owner.canvasId}`, input.stageId);
  }
  const canvases = doc.getMap("canvases");
  const mayEnsureMain = input.canvasId === DEFAULT_CANVAS_ID && canvases.size === 0;
  if (!mayEnsureMain && !canvases.get(input.canvasId)) {
    return ownershipError("CANVAS_NOT_FOUND", `Canvas ${input.canvasId} not found`, input.stageId);
  }
  if (doc.getMap("nodes").get(input.actionNodeId)) {
    return ownershipError("NODE_EXISTS", `Node ${input.actionNodeId} already exists`, input.stageId);
  }
  const advanced = advanceLocalDirectorStageGenerator(doc, definition, {
    ...read.stage,
    owner: { kind: "canvas-action", canvasId: input.canvasId, actionNodeId: input.actionNodeId },
  });
  if (!advanced.ok) return advanced;
  if (mayEnsureMain) ensureProjectCanvas(doc);
  doc.getMap("nodes").set(input.actionNodeId, {
    canvasId: input.canvasId,
    type: "director-stage",
    data: { stageId: input.stageId, label: read.stage.name },
    position: input.position,
  });
  return { ok: true, stage: advanced.stage };
}

/** Detach a Canvas-owned native DirectorStage and remove only its matching owner node. */
export function detachLocalDirectorStageGeneratorFromCanvas(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  stageId: string,
): OwnLocalDirectorStageGeneratorResult {
  const read = readLocalDirectorStageGenerator(doc, definition, stageId);
  if (!read.ok) return read;
  if (read.stage.owner.kind !== "canvas-action") {
    return ownershipError("DIRECTOR_STAGE_ALREADY_STANDALONE", `DirectorStage ${stageId} is already standalone`, stageId);
  }
  const owner = read.stage.owner;
  const advanced = advanceLocalDirectorStageGenerator(doc, definition, {
    ...read.stage,
    owner: { kind: "project" },
  });
  if (!advanced.ok) return advanced;
  const raw = doc.getMap("nodes").get(owner.actionNodeId);
  const nodeCanvasId = isRecord(raw) && typeof raw.canvasId === "string" ? raw.canvasId : DEFAULT_CANVAS_ID;
  if (stageIdFromActionNode(raw) === stageId && nodeCanvasId === owner.canvasId) {
    new Canvas(doc, () => {}, owner.canvasId).deleteNode(owner.actionNodeId);
  }
  return { ok: true, stage: advanced.stage };
}

/** Copy a Canvas-owned DirectorStage to a fresh native Generator and Action node. */
export function copyLocalDirectorStageGeneratorActionToCanvas(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  input: {
    sourceDirectorStageId: string;
    targetCanvasId: string;
    newDirectorStageId: string;
    newActionNodeId: string;
    position: { x: number; y: number };
  },
): OwnLocalDirectorStageGeneratorResult {
  const sourceRead = readLocalDirectorStageGenerator(doc, definition, input.sourceDirectorStageId);
  if (!sourceRead.ok) return sourceRead;
  const source = sourceRead.stage;
  if (source.owner.kind !== "canvas-action") {
    return ownershipError("DIRECTOR_STAGE_STANDALONE", `DirectorStage ${input.sourceDirectorStageId} is standalone`, input.sourceDirectorStageId);
  }
  const canvases = doc.getMap("canvases");
  const mayEnsureMain = input.targetCanvasId === DEFAULT_CANVAS_ID && canvases.size === 0;
  if (!mayEnsureMain && !canvases.get(input.targetCanvasId)) {
    return ownershipError("CANVAS_NOT_FOUND", `Canvas ${input.targetCanvasId} not found`, input.newDirectorStageId);
  }
  if (doc.getMap(PROJECT_GENERATORS_CONTAINER).get(input.newDirectorStageId)) {
    return ownershipError("PROJECT_GENERATOR_EXISTS", `DirectorStage ${input.newDirectorStageId} already exists`, input.newDirectorStageId);
  }
  if (doc.getMap("nodes").get(input.newActionNodeId)) {
    return ownershipError("NODE_EXISTS", `Node ${input.newActionNodeId} already exists`, input.newDirectorStageId);
  }
  const sourceAction = doc.getMap("nodes").get(source.owner.actionNodeId);
  const sourceData = isRecord(sourceAction) && isRecord(sourceAction.data) ? sourceAction.data : {};
  const created = createLocalDirectorStageGenerator(doc, definition, {
    id: input.newDirectorStageId,
    name: source.name,
    owner: { kind: "canvas-action", canvasId: input.targetCanvasId, actionNodeId: input.newActionNodeId },
    revisionId: "",
    state: structuredClone(source.state),
  });
  if (!created.ok) return created;
  if (mayEnsureMain) ensureProjectCanvas(doc);
  doc.getMap("nodes").set(input.newActionNodeId, {
    canvasId: input.targetCanvasId,
    type: "director-stage",
    data: { ...sourceData, stageId: input.newDirectorStageId, label: source.name },
    position: input.position,
  });
  return { ok: true, stage: created.stage };
}

export function deleteLocalDirectorStageGenerator(
  doc: LoroDoc,
  definition: GeneratorDefinition,
  input: {
    stageId: string;
    expectedHeadRevisionId: string;
    operationId: string;
  },
): DeleteLocalDirectorStageGeneratorResult {
  const surfaceCheck = requireDirectorStageSurface(definition);
  if (!surfaceCheck.ok) return surfaceCheck;

  const head = readProjectGenerator(doc, input.stageId);
  if (head && !definitionRefsMatch(head.definitionRef, definitionRefOf(definition))) {
    return {
      ok: false,
      error: {
        code: "GENERATOR_DEFINITION_REF_MISMATCH",
        message: `Project Generator ${input.stageId} does not belong to this Definition family.`,
        generatorId: input.stageId,
      },
    };
  }

  const result = deleteProjectGenerator(doc, {
    generatorId: input.stageId,
    expectedHeadRevisionId: input.expectedHeadRevisionId,
    operationId: input.operationId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, tombstone: result.tombstone, changed: result.changed };
}
