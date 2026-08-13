/**
 * Project command host — local-api's in-process authority for Canvas, Timeline,
 * Director Stage, and projected text commands used by the CLI.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { LoroDoc } from "loro-crdt";
import {
  agentReadReceiptToken,
  AGENT_NODE_TYPE_MAP,
  DEFAULT_CANVAS_ID,
  LoroSyncClient,
  PROJECT_ASSET_RENDER_CANVAS_ID,
  createMediaAssetCowNodeData,
  createDefaultDirectorStageState,
  coerceModelParameterInput,
  ExecutablePluginBindingSchema,
  extractAssetRefs,
  isMediaNodeType,
  MODEL_CARDS,
  normalizeModelId,
  parsePromptParts,
  pickDefaultModel,
  projectDirectorStageReadToken,
  projectCanvasReadToken,
  projectTimelineReadToken,
  readProjectTimeline,
  requestTimelineRender,
  TIMELINE_DSL_DEFINITION,
  validateTimelineDsl,
  validateAgentObservation,
  validateAgentReadProof,
  type AgentReadReceiptProof,
  canvasBatchDeleteReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  isCanvasNodeImmutable,
  validateCanvasBatchDelete,
  validateCanvasBatchDeleteReadProof,
  validateCanvasCheckpointPatch,
  validateCanvasDelete,
  validateCanvasContentPatch,
  validateCanvasEdgeAdd,
  validateCanvasMediaAssetPatch,
  validateCanvasReadProof,
  validateCanvasUpdateDataFields,
  type CanvasReadProofEdgeLike,
  type ModelCard,
  hostMutationRejected,
  hostMutationSucceeded,
  validateHostMutationEnvelope,
} from "@clash/shared-types";
import {
  createTextAppliedRevision,
  createTextCowNodeData,
  textHash,
  textReadToken,
  textContentFromNode,
  type TextRevisionActor,
} from "./project-text-projection.js";

const LOCAL_API_READ_RECEIPT_SECRET = randomBytes(32).toString("hex");

function hostCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-node:${readToken}`)
    .digest("base64url");
}

function hostCanvasEdgesReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-edges:${readToken}`)
    .digest("base64url");
}

function hostCanvasBatchDeleteReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`canvas-batch-delete:${readToken}`)
    .digest("base64url");
}

function canvasNodeReceiptReadToken(node: Parameters<typeof canvasNodeReadToken>[0]): string {
  const readToken = canvasNodeReadToken(node);
  return agentReadReceiptToken({
    readToken,
    receipt: hostCanvasReadReceipt(readToken),
  });
}

function canvasBatchDeleteReceiptReadToken(options: Parameters<typeof canvasBatchDeleteReadToken>[0]): string {
  const readToken = canvasBatchDeleteReadToken(options);
  return agentReadReceiptToken({
    readToken,
    receipt: hostCanvasBatchDeleteReadReceipt(readToken),
  });
}

function verifyHostCanvasReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "node" &&
    proof.receipt === hostCanvasReadReceipt(proof.baseReadToken);
}

function verifyHostCanvasBatchDeleteReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "canvas-batch-delete" &&
    proof.receipt === hostCanvasBatchDeleteReadReceipt(proof.baseReadToken);
}

function hostProjectCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`project-canvas:${readToken}`)
    .digest("base64url");
}

function projectCanvasReceiptReadToken(canvas: Parameters<typeof projectCanvasReadToken>[0]): string {
  const readToken = projectCanvasReadToken(canvas);
  return agentReadReceiptToken({
    readToken,
    receipt: hostProjectCanvasReadReceipt(readToken),
  });
}

function verifyHostProjectCanvasReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "canvas" &&
    proof.receipt === hostProjectCanvasReadReceipt(proof.baseReadToken);
}

function hostProjectTimelineReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`project-timeline:${readToken}`)
    .digest("base64url");
}

function projectTimelineReceiptReadToken(timeline: Parameters<typeof projectTimelineReadToken>[0]): string {
  const readToken = projectTimelineReadToken(timeline);
  return agentReadReceiptToken({
    readToken,
    receipt: hostProjectTimelineReadReceipt(readToken),
  });
}

function verifyHostProjectTimelineReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "timeline" &&
    proof.receipt === hostProjectTimelineReadReceipt(proof.baseReadToken);
}

function validateHostProjectTimelineRead(options: {
  cmd: Record<string, unknown>;
  currentVersion: string;
  operation: string;
}) {
  return typeof options.cmd.ifMatch === "string"
    ? validateAgentReadProof({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        currentReadToken: options.currentVersion,
        expectedReadToken: options.cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyHostProjectTimelineReadReceipt,
        readCommandHint: "Run `clash timeline list --json` or `clash timeline pull --timeline <id>` first.",
      })
    : validateAgentObservation({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        observedVersion: typeof options.cmd.observedVersion === "string"
          ? options.cmd.observedVersion
          : undefined,
        currentVersion: options.currentVersion,
      });
}

function hostProjectDirectorStageReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`project-director-stage:${readToken}`)
    .digest("base64url");
}

function projectDirectorStageReceiptReadToken(
  stage: Parameters<typeof projectDirectorStageReadToken>[0],
): string {
  const readToken = projectDirectorStageReadToken(stage);
  return agentReadReceiptToken({
    readToken,
    receipt: hostProjectDirectorStageReadReceipt(readToken),
  });
}

function verifyHostProjectDirectorStageReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "director-stage" &&
    proof.receipt === hostProjectDirectorStageReadReceipt(proof.baseReadToken);
}

function validateHostProjectDirectorStageRead(options: {
  cmd: Record<string, unknown>;
  currentVersion: string;
  operation: string;
}) {
  return typeof options.cmd.ifMatch === "string"
    ? validateAgentReadProof({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        currentReadToken: options.currentVersion,
        expectedReadToken: options.cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyHostProjectDirectorStageReadReceipt,
        readCommandHint: "Run `clash director list --json` or `clash director pull --stage <id>` first.",
      })
    : validateAgentObservation({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        observedVersion: typeof options.cmd.observedVersion === "string"
          ? options.cmd.observedVersion
          : undefined,
        currentVersion: options.currentVersion,
      });
}

function guardError(guard: { ok: false; error: string; code?: string }): object {
  return {
    error: guard.error,
    ...(guard.code ? { code: guard.code } : {}),
  };
}

function hostTextReadReceipt(readToken: string): string {
  return createHmac("sha256", LOCAL_API_READ_RECEIPT_SECRET)
    .update(`text:${readToken}`)
    .digest("base64url");
}

function textNodeReceiptReadToken(options: {
  projectId: string;
  nodeId: string;
  content: string;
}): string {
  const readToken = textReadToken(options);
  return agentReadReceiptToken({
    readToken,
    receipt: hostTextReadReceipt(readToken),
  });
}

function verifyHostTextReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "text" &&
    proof.receipt === hostTextReadReceipt(proof.baseReadToken);
}

function listCanvasEdgesWithVersion(client: LoroSyncClient): {
  edges: CanvasReadProofEdgeLike[];
  version: string;
  readToken: string;
} {
  const edges = listCanvasReadProofEdges(client);
  const version = canvasEdgesReadToken(edges);
  return {
    edges,
    version,
    readToken: agentReadReceiptToken({
      readToken: version,
      receipt: hostCanvasEdgesReadReceipt(version),
    }),
  };
}

function listCanvasReadProofEdges(client: LoroSyncClient): CanvasReadProofEdgeLike[] {
  return client.canvas.listEdges().map((edge) => ({ ...edge }));
}

function readCanvasBatchDeletePlan(client: LoroSyncClient, nodeIds: unknown): {
  nodeIds: string[];
  nodes: NonNullable<ReturnType<LoroSyncClient["readNode"]>>[];
  edges: CanvasReadProofEdgeLike[];
  version: string;
  readToken: string;
} | { error: string } {
  if (!Array.isArray(nodeIds)) return { error: "delete batch requires nodeIds" };
  const uniqueNodeIds = [...new Set(nodeIds.map((nodeId) => String(nodeId ?? "").trim()).filter(Boolean))];
  if (uniqueNodeIds.length === 0) return { error: "delete batch requires at least one node id" };
  const nodes: NonNullable<ReturnType<LoroSyncClient["readNode"]>>[] = [];
  const missing: string[] = [];
  for (const nodeId of uniqueNodeIds) {
    const node = client.readNode(nodeId);
    if (!node) missing.push(nodeId);
    else nodes.push(node);
  }
  if (missing.length > 0) return { error: `Node(s) not found: ${missing.join(", ")}` };
  const edges = listCanvasReadProofEdges(client);
  return {
    nodeIds: uniqueNodeIds,
    nodes,
    edges,
    version: canvasBatchDeleteReadToken({ nodes, edges }),
    readToken: canvasBatchDeleteReceiptReadToken({ nodes, edges }),
  };
}

function canvasGuardrailEdgesFromReadProof(
  edges: CanvasReadProofEdgeLike[],
): Array<{ source: string; target: string }> {
  return edges
    .map((edge) => ({
      source: typeof edge.source === "string" ? edge.source : "",
      target: typeof edge.target === "string" ? edge.target : "",
    }))
    .filter((edge) => edge.source && edge.target);
}

function coerceHostParameter(value: string | number | boolean): string | number | boolean {
  if (typeof value !== "string") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
}

function hostModelParams(
  modelCards: readonly ModelCard[],
  modelId: string | undefined,
  params: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  const normalizedModelId = normalizeModelId(modelId) ?? modelId;
  const card = modelCards.find((candidate) => candidate.id === normalizedModelId);
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([key, raw]) => {
      const value = coerceHostParameter(raw);
      return [key, card ? coerceModelParameterInput(card, key, value) : value];
    }),
  );
}

function resolveCanvasReferenceNodeIds(
  client: LoroSyncClient,
  refs: string[],
): { refNodeIds: string[]; unresolvedReferences: string[] } {
  const nodes = client.listNodes();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeIdByAssetId = new Map<string, string>();
  for (const node of nodes) {
    const assetId = node.data?.assetId;
    if (typeof assetId === "string" && assetId.trim()) {
      nodeIdByAssetId.set(assetId, node.id);
    }
  }

  const refNodeIds: string[] = [];
  const unresolvedReferences: string[] = [];
  for (const ref of [...new Set(refs.map((value) => value.trim()).filter(Boolean))]) {
    const nodeId = nodeIds.has(ref) ? ref : nodeIdByAssetId.get(ref);
    if (!nodeId) unresolvedReferences.push(ref);
    else if (!refNodeIds.includes(nodeId)) refNodeIds.push(nodeId);
  }
  return { refNodeIds, unresolvedReferences };
}

function generationOutputType(nodeType: string): "image" | "video" | "audio" | "text" {
  if (nodeType === "video_gen") return "video";
  if (nodeType === "audio_gen") return "audio";
  if (nodeType === "text_gen") return "text";
  return "image";
}

export type ProjectCommandHostContext = {
  actorUserId?: string;
  effectiveModelCards?: readonly ModelCard[];
  trustedCustomActions?: readonly Record<string, unknown>[];
  /** Host-private pending output identity, preallocated before the Project snapshot commits. */
  generationId?: () => string;
};

export function handleProjectCommand(
  projectId: string,
  doc: LoroDoc,
  cmd: Record<string, unknown>,
  context: ProjectCommandHostContext = {},
): object {
  const modelCards = context.effectiveModelCards ?? MODEL_CARDS;
  const clientOptions = {
    serverUrl: "http://127.0.0.1",
    projectId,
    doc,
    modelCards,
  };
  const client = new LoroSyncClient(
    clientOptions as ConstructorParameters<typeof LoroSyncClient>[0],
  );
  return handleCommand(client, { ...cmd, projectId }, {
    ...context,
    effectiveModelCards: modelCards,
  });
}

const READ_ONLY_PROJECT_COMMANDS = new Set([
  "list_canvases",
  "list_timelines",
  "validate_timeline",
  "list_timeline_renders",
  "list_director_stages",
  "capture_director_stage",
  "list",
  "edges",
  "batch_delete_plan",
  "get",
  "search",
  "ping",
]);

export function projectCommandMutates(action: unknown): boolean {
  return typeof action === "string"
    && !READ_ONLY_PROJECT_COMMANDS.has(action);
}

export function handleCommandForTest(
  client: LoroSyncClient,
  cmd: any,
  context: ProjectCommandHostContext = {},
): object {
  return handleCommand(client, cmd, {
    ...context,
    effectiveModelCards: context.effectiveModelCards ?? MODEL_CARDS,
  });
}

function handleCommand(
  client: LoroSyncClient,
  cmd: any,
  context: ProjectCommandHostContext,
): object {
  const { action } = cmd;
  const projectWorkspaceAction = action === "list_canvases" ||
    action === "create_canvas" ||
    action === "rename_canvas" ||
    action === "delete_canvas" ||
    action === "list_timeline_renders" ||
    action === "list_timelines" ||
    action === "validate_timeline" ||
    action === "create_timeline" ||
    action === "update_timeline_state" ||
    action === "attach_timeline" ||
    action === "detach_timeline" ||
    action === "copy_timeline_action" ||
    action === "request_timeline_render" ||
    action === "list_director_stages" ||
    action === "capture_director_stage" ||
    action === "create_director_stage" ||
    action === "update_director_stage_state" ||
    action === "attach_director_stage" ||
    action === "detach_director_stage";
  if (!projectWorkspaceAction) {
    try {
      client.selectCanvas(
        typeof cmd.canvasId === "string" && cmd.canvasId.trim()
          ? cmd.canvasId
          : DEFAULT_CANVAS_ID,
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  switch (action) {
    case "list_canvases": {
      const canvases = client.listCanvases();
      return {
        canvases,
        versions: Object.fromEntries(
          canvases.map((canvas) => [canvas.id, projectCanvasReceiptReadToken(canvas)]),
        ),
      };
    }

    case "create_canvas": {
      const result = client.createCanvas({ id: cmd.canvasId, name: cmd.name });
      return result.ok
        ? {
            canvas: result.canvas,
            version: projectCanvasReadToken(result.canvas),
            readToken: projectCanvasReceiptReadToken(result.canvas),
          }
        : { error: result.error };
    }

    case "rename_canvas": {
      const current = client.listCanvases().find((canvas) => canvas.id === cmd.canvasId);
      if (!current) return { error: `Canvas ${cmd.canvasId} not found` };
      const currentVersion = projectCanvasReadToken(current);
      const guard = typeof cmd.ifMatch === "string"
        ? validateAgentReadProof({
            actorClientType: cmd.actorClientType,
            operation: "Canvas rename",
            currentReadToken: currentVersion,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostProjectCanvasReadReceipt,
            readCommandHint: "Run `clash canvases list --json` first.",
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "renaming the Canvas",
            observedVersion: cmd.observedVersion,
            currentVersion,
          });
      if (!guard.ok) return guardError(guard);
      const result = client.renameCanvas(cmd.canvasId, cmd.name);
      return result.ok
        ? {
            canvas: result.canvas,
            version: projectCanvasReadToken(result.canvas),
            readToken: projectCanvasReceiptReadToken(result.canvas),
          }
        : { error: result.error };
    }

    case "delete_canvas": {
      const current = client.listCanvases().find((canvas) => canvas.id === cmd.canvasId);
      if (!current) return { error: `Canvas ${cmd.canvasId} not found` };
      const currentVersion = projectCanvasReadToken(current);
      const guard = typeof cmd.ifMatch === "string"
        ? validateAgentReadProof({
            actorClientType: cmd.actorClientType,
            operation: "Canvas delete",
            currentReadToken: currentVersion,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostProjectCanvasReadReceipt,
            readCommandHint: "Run `clash canvases list --json` first.",
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "deleting the Canvas",
            observedVersion: cmd.observedVersion,
            currentVersion,
          });
      if (!guard.ok) return guardError(guard);
      const result = client.deleteCanvas(cmd.canvasId);
      return result.ok
        ? { deleted: true, canvasId: result.canvasId }
        : { error: result.error };
    }

    case "list_timelines": {
      const timelines = client.listTimelines();
      return {
        timelines,
        versions: Object.fromEntries(
          timelines.map((timeline) => [timeline.id, projectTimelineReceiptReadToken(timeline)]),
        ),
      };
    }

    case "validate_timeline": {
      const validation = validateTimelineDsl(cmd.document);
      return validation.ok
        ? {
            ok: true,
            issues: [],
            contractFingerprint: TIMELINE_DSL_DEFINITION.contractFingerprint,
          }
        : {
            ok: false,
            issues: validation.issues,
            contractFingerprint: TIMELINE_DSL_DEFINITION.contractFingerprint,
          };
    }

    case "list_timeline_renders": {
      const status = cmd.status ?? "completed";
      if (status !== "completed" && status !== "all") {
        return {
          error: "Timeline render status must be 'completed' or 'all'",
        };
      }
      const renders = client
        .canvasFor(PROJECT_ASSET_RENDER_CANVAS_ID)
        .listNodes("video")
        .filter((node) => status === "all" || node.data.status === "completed")
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node) => {
          const version = canvasNodeReadToken(node);
          return {
            node,
            lineage: {
              sourceTimelineId:
                typeof node.data.sourceTimelineId === "string"
                  ? node.data.sourceTimelineId
                  : null,
              sourceTimelineRevisionId:
                typeof node.data.sourceTimelineRevisionId === "string"
                  ? node.data.sourceTimelineRevisionId
                  : null,
              renderTarget: node.data.renderTarget ?? null,
              assetId:
                typeof node.data.assetId === "string" ? node.data.assetId : null,
              status:
                typeof node.data.status === "string" ? node.data.status : null,
            },
            version,
            readToken: canvasNodeReceiptReadToken(node),
          };
        });
      return {
        canvasId: PROJECT_ASSET_RENDER_CANVAS_ID,
        status,
        renders,
      };
    }

    case "request_timeline_render": {
      if (typeof cmd.timelineId !== "string" || !cmd.timelineId.trim()) {
        return { error: "request_timeline_render requires timelineId" };
      }
      const timelineId = cmd.timelineId.trim();
      const current = readProjectTimeline(client.doc, timelineId);
      if (!current) return { error: `Timeline ${timelineId} not found` };
      const guard = validateHostProjectTimelineRead({
        cmd,
        operation: "Timeline render",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const actorUserId = context.actorUserId?.trim();
      if (!actorUserId) return { error: "Timeline render requires an authenticated host user" };
      const requested = requestTimelineRender(client.doc, {
        timelineId,
        actorUserId,
        ...(typeof cmd.actorAgentId === "string" && cmd.actorAgentId.trim()
          ? { actorAgentId: cmd.actorAgentId.trim() }
          : {}),
        generateId: () => crypto.randomUUID().slice(0, 8),
      });
      if (!requested.ok) return { error: requested.error };
      client.doc.commit({ origin: "local-api:timeline-render" });
      return {
        submitted: true,
        timelineId,
        sourceTimelineRevisionId: current.revisionId,
        renderNodeId: requested.renderNodeId,
        target: requested.target,
      };
    }

    case "create_timeline": {
      const result = client.createTimeline({
        id: cmd.timelineId,
        name: cmd.name,
        state: cmd.state ?? { tracks: [] },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "update_timeline_state": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateHostProjectTimelineRead({
        cmd,
        operation: "Timeline apply",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.updateTimelineState(cmd.timelineId, cmd.state);
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "attach_timeline": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateHostProjectTimelineRead({
        cmd,
        operation: "Timeline attach",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.attachTimeline({
        timelineId: cmd.timelineId,
        canvasId: cmd.canvasId,
        actionNodeId: typeof cmd.actionNodeId === "string" && cmd.actionNodeId.trim()
          ? cmd.actionNodeId.trim()
          : crypto.randomUUID().slice(0, 8),
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "detach_timeline": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateHostProjectTimelineRead({
        cmd,
        operation: "Timeline detach",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.detachTimeline(cmd.timelineId);
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "copy_timeline_action": {
      const current = client.listTimelines().find(
        (timeline) => timeline.id === cmd.sourceTimelineId,
      );
      if (!current) return { error: `Timeline ${cmd.sourceTimelineId} not found` };
      const sourceVersion = projectTimelineReadToken(current);
      const guard = validateHostProjectTimelineRead({
        cmd,
        operation: "Timeline Action copy",
        currentVersion: sourceVersion,
      });
      if (!guard.ok) return guardError(guard);
      const result = client.copyTimelineAction({
        sourceTimelineId: cmd.sourceTimelineId,
        targetCanvasId: cmd.targetCanvasId,
        newTimelineId: typeof cmd.newTimelineId === "string" && cmd.newTimelineId.trim()
          ? cmd.newTimelineId.trim()
          : `${cmd.sourceTimelineId}-copy-${crypto.randomUUID().slice(0, 8)}`,
        newActionNodeId: typeof cmd.newActionNodeId === "string" && cmd.newActionNodeId.trim()
          ? cmd.newActionNodeId.trim()
          : crypto.randomUUID().slice(0, 8),
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
            sourceVersion,
          }
        : { error: result.error };
    }

    case "list_director_stages": {
      const stages = client.listDirectorStages();
      return {
        stages,
        versions: Object.fromEntries(
          stages.map((stage) => [stage.id, projectDirectorStageReceiptReadToken(stage)]),
        ),
      };
    }

    case "create_director_stage": {
      const result = client.createDirectorStage({
        id: cmd.stageId,
        name: cmd.name,
        state: cmd.state ?? createDefaultDirectorStageState(),
      });
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "update_director_stage_state": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateHostProjectDirectorStageRead({
        cmd,
        operation: "Director Stage apply",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.updateDirectorStageState(cmd.stageId, cmd.state);
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "attach_director_stage": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateHostProjectDirectorStageRead({
        cmd,
        operation: "Director Stage attach",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.attachDirectorStage({
        stageId: cmd.stageId,
        canvasId: cmd.canvasId,
        actionNodeId: typeof cmd.actionNodeId === "string" && cmd.actionNodeId.trim()
          ? cmd.actionNodeId.trim()
          : crypto.randomUUID().slice(0, 8),
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "detach_director_stage": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateHostProjectDirectorStageRead({
        cmd,
        operation: "Director Stage detach",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.detachDirectorStage(cmd.stageId);
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "capture_director_stage": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateHostProjectDirectorStageRead({
        cmd,
        operation: "Director Stage capture",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      return {
        stage: current,
        sourceStageRevisionId: current.revisionId,
        version: projectDirectorStageReadToken(current),
        readToken: projectDirectorStageReceiptReadToken(current),
      };
    }

    case "list": {
      const nodes = client.listNodes(cmd.type ?? undefined);
      return {
        nodes,
        versions: Object.fromEntries(
          nodes.map((node) => [node.id, canvasNodeReceiptReadToken(node)]),
        ),
      };
    }

    case "edges": {
      return listCanvasEdgesWithVersion(client);
    }

    case "batch_delete_plan": {
      return readCanvasBatchDeletePlan(client, cmd.nodeIds);
    }

    case "get": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const result: Record<string, unknown> = {
        node,
        immutable: isCanvasNodeImmutable({
          nodeId: cmd.nodeId,
          edges: client.canvas.listEdges(),
        }),
        version: canvasNodeReadToken(node),
        readToken: canvasNodeReceiptReadToken(node),
      };
      if (typeof cmd.projectId === "string" && typeof cmd.nodeId === "string") {
        if (node.type === "text") {
          result.textReadToken = textNodeReceiptReadToken({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            content: textContentFromNode({ type: node.type, data: node.data as Record<string, unknown> }),
          });
        }
      }
      return result;
    }

    case "add": {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const requestedNodeType = String(cmd.type);
      const mapping = AGENT_NODE_TYPE_MAP[
        requestedNodeType as keyof typeof AGENT_NODE_TYPE_MAP
      ];
      if (!mapping) return { error: `Unsupported Canvas node type: ${requestedNodeType}` };
      const outputKind = requestedNodeType.endsWith("_gen")
        ? generationOutputType(requestedNodeType)
        : undefined;
      const isGenerationNode = outputKind !== undefined;
      const data: Record<string, unknown> = { label: cmd.label };

      if (typeof cmd.parentId === "string") {
        const parent = client.readNode(cmd.parentId);
        if (!parent || parent.type !== "group") {
          return { error: `Parent group not found: ${cmd.parentId}` };
        }
      }
      if (!isGenerationNode && (
        cmd.prompt !== undefined || cmd.modelId !== undefined || cmd.actionId !== undefined
        || cmd.refs !== undefined || cmd.params !== undefined
      )) {
        return { error: `Generation fields are not valid for Canvas node type ${requestedNodeType}` };
      }
      if (cmd.actionId !== undefined && cmd.modelId !== undefined) {
        return { error: "Canvas add accepts either actionId or modelId, not both" };
      }

      if (context.actorUserId) {
        data.actorType = cmd.actorClientType === "agent" || typeof cmd.actorAgentId === "string"
          ? "agent"
          : "user";
        data.actorUserId = context.actorUserId;
        if (typeof cmd.actorAgentId === "string") data.actorAgentId = cmd.actorAgentId;
      }

      const promptReferenceIds = typeof cmd.prompt === "string"
        ? extractAssetRefs(parsePromptParts(cmd.prompt)).map((reference) => reference.nodeId)
        : [];
      const references = resolveCanvasReferenceNodeIds(client, [
        ...(Array.isArray(cmd.refs) ? cmd.refs : []),
        ...promptReferenceIds,
      ]);
      if (references.unresolvedReferences.length > 0) {
        return {
          code: "UNRESOLVED_REFERENCE",
          error: `Canvas reference(s) not found: ${references.unresolvedReferences.join(", ")}`,
          unresolvedReferences: references.unresolvedReferences,
        };
      }

      let trustedActionToRegister: Record<string, unknown> | undefined;

      if (isGenerationNode) {
        const prompt = typeof cmd.prompt === "string" ? cmd.prompt : undefined;
        if (prompt !== undefined) {
          data.prompt = prompt;
          data.content = prompt;
        }
        if (typeof cmd.actionId === "string" && cmd.actionId.trim()) {
          const actionId = cmd.actionId.trim();
          const installedDefinition = client.canvas.getCustomAction(actionId) as Record<string, unknown> | null;
          const trustedDefinition = context.trustedCustomActions?.find(
            (candidate) => candidate.id === actionId,
          );
          const definition = installedDefinition ?? trustedDefinition ?? null;
          if (!definition) {
            return { code: "UNKNOWN_CUSTOM_ACTION", error: `Custom action not installed: ${actionId}` };
          }
          if (!installedDefinition && trustedDefinition) trustedActionToRegister = trustedDefinition;
          data.actionType = `custom:${actionId}`;
          data.customActionId = actionId;
          data.customActionParams = hostModelParams(
            context.effectiveModelCards ?? MODEL_CARDS,
            undefined,
            cmd.params,
          );
          data.outputType = definition?.outputType === "image" || definition?.outputType === "video"
            || definition?.outputType === "audio" || definition?.outputType === "text"
            ? definition.outputType
            : generationOutputType(requestedNodeType);
          const pluginBinding = ExecutablePluginBindingSchema.safeParse(definition?.pluginBinding);
          if (pluginBinding.success) data.pluginBinding = pluginBinding.data;
        } else {
          const modelCards = context.effectiveModelCards ?? MODEL_CARDS;
          const requestedModelId = typeof cmd.modelId === "string" ? cmd.modelId.trim() : "";
          const normalizedModelId = normalizeModelId(requestedModelId) ?? requestedModelId;
          const modelCard = requestedModelId
            ? modelCards.find((candidate) => candidate.id === normalizedModelId)
            : pickDefaultModel({ outputKind: outputKind!, cards: modelCards });
          if (!modelCard) {
            return {
              code: "MODEL_NOT_AVAILABLE",
              error: requestedModelId
                ? `Model is not available in the local host catalog: ${requestedModelId}`
                : `No default ${outputKind} model is available in the local host catalog`,
            };
          }
          if ("actionType" in mapping) data.actionType = mapping.actionType;
          data.modelId = modelCard.id;
          data.modelParams = hostModelParams(modelCards, modelCard.id, cmd.params);
        }
      } else {
        if (typeof cmd.content === "string") data.content = cmd.content;
      }

      if (isGenerationNode && references.refNodeIds.length > 0) {
        data.referenceImageOrder = references.refNodeIds;
      }

      if (trustedActionToRegister) {
        client.doc.getMap("customActions").set(String(trustedActionToRegister.id), trustedActionToRegister);
        client.doc.commit({ origin: "local-api:add-trusted-custom-action" });
      }

      const generatedAssetId = isGenerationNode ? crypto.randomUUID().slice(0, 8) : null;
      if (generatedAssetId) data.assetId = generatedAssetId;
      let result: {
        node_id: string | null;
        error: string | null;
        proposal: Record<string, unknown> | null;
        asset_id: string | null;
      };
      if (references.refNodeIds.length > 0) {
        const [firstSourceId, ...remainingSourceIds] = references.refNodeIds;
        client.canvas.createLinkedNode({
          nodeId,
          nodeType: mapping.rfType,
          data,
          parentId: cmd.parentId ?? null,
          sourceNodeId: firstSourceId,
          edgeId: `ref-${firstSourceId}-${nodeId}`,
          edgeType: "reference",
        });
        for (const sourceId of remainingSourceIds) {
          client.canvas.insertEdge(`ref-${sourceId}-${nodeId}`, sourceId, nodeId, "reference");
        }
        result = { node_id: nodeId, error: null, proposal: null, asset_id: generatedAssetId };
      } else {
        result = client.createNode(
          nodeId,
          requestedNodeType,
          data,
          null,
          cmd.parentId ?? null,
          generatedAssetId,
        );
      }
      if (result.error || !result.node_id) return result;
      const node = client.readNode(result.node_id);
      const version = node ? canvasNodeReadToken(node) : undefined;
      const readToken = node ? canvasNodeReceiptReadToken(node) : undefined;
      return {
        ...result,
        node,
        refNodeIds: isGenerationNode ? references.refNodeIds : [],
        ...(version ? { version } : {}),
        ...(readToken ? { readToken } : {}),
      };
    }

    case "update": {
      const updates: Record<string, unknown> = { ...(cmd.data ?? {}) };
      const guard = validateCanvasUpdateDataFields(Object.keys(updates));
      if (!guard.ok) return { error: guard.error };
      if (typeof cmd.label === "string") updates.label = cmd.label;
      if (typeof cmd.content === "string") updates.content = cmd.content;
      if (Object.keys(updates).length === 0) {
        return { error: "Provide at least one field to update (--label, --content, --asset-id, --data k=v)" };
      }
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas update",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      if (isCanvasNodeImmutable({ nodeId: cmd.nodeId, edges })) {
        const error = "IMMUTABLE_NODE";
        return {
          code: error,
          error,
          entity: { kind: "canvas-node", id: cmd.nodeId },
          mutation: hostMutationRejected(hostMutation.envelope, error),
        };
      }
      if (typeof updates.content === "string") {
        const contentGuard = validateCanvasContentPatch({
          nodeId: cmd.nodeId,
          node: { type: node.type },
          nodes: client.listNodes(),
          edges,
          hasContentPatch: true,
        });
        if (!contentGuard.ok) return { error: contentGuard.error, mutation: hostMutationRejected(hostMutation.envelope, contentGuard.error) };
      }
      const mediaGuard = validateCanvasMediaAssetPatch({
        nodeId: cmd.nodeId,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        edges,
        hasAssetIdPatch: Object.prototype.hasOwnProperty.call(updates, "assetId"),
        nextAssetId: updates.assetId,
      });
      if (!mediaGuard.ok) return { error: mediaGuard.error, mutation: hostMutationRejected(hostMutation.envelope, mediaGuard.error) };
      const checkpointGuard = validateCanvasCheckpointPatch({
        nodeId: cmd.nodeId,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        nodes: client.listNodes(),
        edges,
        fields: Object.keys(updates),
      });
      if (!checkpointGuard.ok) return { error: checkpointGuard.error, mutation: hostMutationRejected(hostMutation.envelope, checkpointGuard.error) };
      const ok = client.updateNode(cmd.nodeId, updates);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      const updatedNode = client.readNode(cmd.nodeId);
      const version = updatedNode ? canvasNodeReadToken(updatedNode) : undefined;
      const afterReadToken = updatedNode ? canvasNodeReceiptReadToken(updatedNode) : undefined;
      return {
        updated: true,
        nodeId: cmd.nodeId,
        ...(version ? { version } : {}),
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "move": {
      const x = Number(cmd.position?.x);
      const y = Number(cmd.position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { error: "Canvas move requires finite x and y coordinates" };
      }
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas move",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_move",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const moved = client.canvas.moveNode(cmd.nodeId, { x, y });
      if (!moved) {
        const error = `Node not found: ${cmd.nodeId}`;
        return { error, mutation: hostMutationRejected(hostMutation.envelope, error) };
      }
      const updatedNode = client.readNode(cmd.nodeId);
      const version = updatedNode ? canvasNodeReadToken(updatedNode) : undefined;
      const afterReadToken = updatedNode ? canvasNodeReceiptReadToken(updatedNode) : undefined;
      return {
        moved: true,
        nodeId: cmd.nodeId,
        position: { x, y },
        ...(version ? { version } : {}),
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "copy_node": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas copy",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_copy_node",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };

      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.trim()
        ? cmd.newNodeId.trim()
        : crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = {
        ...(node.data as Record<string, unknown>),
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
      };
      for (const runtimeField of ["error", "hasRun", "pendingTask", "pendingTaskAt", "progress", "status", "taskId"]) {
        delete data[runtimeField];
      }

      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: node.type,
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }

      const copiedNode = client.readNode(newNodeId);
      if (!copiedNode) {
        const error = `Copied node not found after creation: ${newNodeId}`;
        return { error, mutation: hostMutationRejected(hostMutation.envelope, error) };
      }
      const version = canvasNodeReadToken(copiedNode);
      const afterReadToken = canvasNodeReceiptReadToken(copiedNode);
      return {
        copied: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        node: copiedNode,
        immutable: false,
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        version,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "text_cas_update": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (typeof cmd.content !== "string") {
        return { error: "text_cas_update requires string content" };
      }
      const currentContent = textContentFromNode({
        type: node.type,
        data: node.data as Record<string, unknown>,
      });
      const beforeHash = textHash(currentContent);
      const beforeReadToken = textReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        contentHash: beforeHash,
      });
      const expectedReadToken = typeof cmd.ifMatch === "string"
        ? cmd.ifMatch
        : typeof cmd.observedVersion === "string"
          ? cmd.observedVersion
          : undefined;
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text apply",
        currentReadToken: beforeReadToken,
        expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyHostTextReadReceipt,
        readCommandHint: "Run `clash text pull --json` first, then retry.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cas_update",
        entity: { kind: "text", id: cmd.nodeId },
        currentHash: beforeHash,
        expectedReadToken,
        currentReadToken: beforeReadToken,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      if (isCanvasNodeImmutable({ nodeId: cmd.nodeId, edges: client.canvas.listEdges() })) {
        const error = "IMMUTABLE_NODE";
        return {
          code: error,
          error,
          entity: { kind: "text", id: cmd.nodeId },
          mutation: hostMutationRejected(hostMutation.envelope, error),
        };
      }
      const ok = client.updateNode(cmd.nodeId, { content: cmd.content });
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      const afterHash = textHash(cmd.content);
      const afterReadToken = textNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        content: cmd.content,
      });
      const textRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTextAppliedRevision({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            content: cmd.content,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor: readTextRevisionActor(cmd.actor),
          })
        : undefined;
      return {
        updated: true,
        nodeId: cmd.nodeId,
        textRevision,
        version: textReadToken({
          projectId: cmd.projectId,
          nodeId: cmd.nodeId,
          content: cmd.content,
        }),
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash,
          afterReadToken,
        }),
      };
    }

    case "text_cow_replace": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (node.type !== "text") return { error: `Node ${cmd.nodeId} has type "${node.type}", expected "text"` };
      if (typeof cmd.content !== "string") {
        return { error: "text_cow_replace requires string content" };
      }
      const currentContent = textContentFromNode({
        type: node.type,
        data: node.data as Record<string, unknown>,
      });
      const beforeHash = textHash(currentContent);
      const beforeReadToken = textReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        contentHash: beforeHash,
      });
      const expectedReadToken = typeof cmd.ifMatch === "string"
        ? cmd.ifMatch
        : typeof cmd.observedVersion === "string"
          ? cmd.observedVersion
          : undefined;
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text replace",
        currentReadToken: beforeReadToken,
        expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyHostTextReadReceipt,
        readCommandHint: "Run `clash text pull --json` first, then retry.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cow_replace",
        entity: { kind: "text", id: cmd.nodeId },
        currentHash: beforeHash,
        expectedReadToken,
        currentReadToken: beforeReadToken,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.length > 0
        ? cmd.newNodeId
        : crypto.randomUUID().slice(0, 8);
      const textRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTextAppliedRevision({
            projectId: cmd.projectId,
            nodeId: newNodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            content: cmd.content,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor: readTextRevisionActor(cmd.actor),
          })
        : undefined;
      const data = createTextCowNodeData({
        sourceNodeId: cmd.nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceContent: currentContent,
        content: cmd.content,
        label: typeof cmd.label === "string" ? cmd.label : undefined,
        filePath: typeof cmd.filePath === "string" ? cmd.filePath : undefined,
        textRevision,
      });
      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: "text",
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }
      const afterHash = textHash(cmd.content);
      const afterReadToken = textNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: newNodeId,
        content: cmd.content,
      });
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        sourceContentHash: beforeHash,
        contentHash: afterHash,
        textRevision,
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        version: textReadToken({
          projectId: cmd.projectId,
          nodeId: newNodeId,
          content: cmd.content,
        }),
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash,
          afterReadToken,
        }),
      };
    }

    case "delete": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "delete",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas delete",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      const deleteGuard = validateCanvasDelete({
        nodeId: cmd.nodeId,
        edges,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
      const ok = client.deleteNode(cmd.nodeId);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      return {
        deleted: true,
        nodeId: cmd.nodeId,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
        }),
      };
    }

    case "delete_batch": {
      const plan = readCanvasBatchDeletePlan(client, cmd.nodeIds);
      if ("error" in plan) return { error: plan.error };
      const batchId = plan.nodeIds.join(",");
      const currentReadToken = canvasBatchDeleteReadToken({
        nodes: plan.nodes,
        edges: plan.edges,
      });
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasBatchDeleteReadProof({
            actorClientType: cmd.actorClientType,
            nodes: plan.nodes,
            edges: plan.edges,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasBatchDeleteReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas batch delete",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: batchId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const guardrailEdges = canvasGuardrailEdgesFromReadProof(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
      const result = client.deleteNodes(plan.nodeIds);
      if (result.deletedNodeIds.length === 0) return { error: `Node(s) not found: ${plan.nodeIds.join(", ")}` };
      return {
        deleted: true,
        nodeIds: plan.nodeIds,
        deletedNodeIds: result.deletedNodeIds,
        deletedEdgeIds: result.deletedEdgeIds,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: batchId,
        }),
      };
    }

    case "asset_cow_replace": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (!isMediaNodeType(node.type)) {
        return { error: `Node ${cmd.nodeId} has type "${node.type}", expected image, video, or audio` };
      }
      if (typeof cmd.assetId !== "string" || cmd.assetId.trim().length === 0) {
        return { error: "asset_cow_replace requires assetId" };
      }
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas copy",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.length > 0
        ? cmd.newNodeId
        : crypto.randomUUID().slice(0, 8);
      const sourceAssetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
      const data = createMediaAssetCowNodeData({
        sourceNodeId: cmd.nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceAssetId,
        assetId: cmd.assetId.trim(),
        label: typeof cmd.label === "string" ? cmd.label : undefined,
      });
      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: node.type,
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }
      const newNode = client.readNode(newNodeId);
      const version = newNode ? canvasNodeReadToken(newNode) : undefined;
      const afterReadToken = newNode ? canvasNodeReceiptReadToken(newNode) : undefined;
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        sourceAssetId,
        assetId: cmd.assetId.trim(),
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        ...(version ? { version } : {}),
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "search": {
      const types = cmd.types ?? null;
      const nodes = client.searchNodes(cmd.query, types);
      return { nodes };
    }

    case "execute": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const guard = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyHostCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas execute",
            observedVersion: typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined,
            currentVersion: currentReadToken,
          });
      if (!guard.ok) return guardError(guard);
      const r = client.canvas.execute(
        cmd.nodeId,
        context.generationId ?? (() => crypto.randomUUID().slice(0, 8)),
      );
      if (r.error) return { error: r.error };
      // Echo `kind` so the CLI can pick the right log line. Both
      // pipelines also fill `childNodeId` so the agent can poll the
      // resulting asset/render node for status.
      return { executed: true, kind: r.kind, childNodeId: r.childNodeId, childNodeType: r.childNodeType };
    }

    case "ensure_edge": {
      // Add a default edge from source → target IF no edge between that
      // exact pair already exists. Idempotent so callers don't have to
      // track which edges they've already wired. Used by `clash canvas
      // timeline push` to reflect timeline items' sourceNodeId
      // references as visible canvas edges. Goes through client.canvas
      // so the LoroSyncClient's subscribeLocalUpdates loop broadcasts
      // the change to the project room.
      const source: string = cmd.source;
      const target: string = cmd.target;
      for (const e of client.canvas.listEdges()) {
        if (e.source === source && e.target === target) return { existed: true };
      }
      const guard = validateCanvasEdgeAdd({
        edge: { source, target },
        nodes: client.listNodes(),
        edges: client.canvas.listEdges(),
      });
      if (!guard.ok) return { error: guard.error };
      const edgeId = `e-${source}-${target}-${crypto.randomUUID().slice(0, 4)}`;
      client.canvas.insertEdge(edgeId, source, target, "default");
      return { existed: false, edgeId };
    }

    case "ping": {
      return { pong: true };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

function readTextRevisionActor(value: unknown): TextRevisionActor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as Partial<TextRevisionActor>;
  if (
    (actor.actorType !== "user" && actor.actorType !== "agent") ||
    typeof actor.actorUserId !== "string"
  ) {
    return undefined;
  }
  return {
    actorType: actor.actorType,
    actorUserId: actor.actorUserId,
    ...(typeof actor.actorAgentId === "string" ? { actorAgentId: actor.actorAgentId } : {}),
  };
}
