/**
 * Workflow tool — single unified entry point for whole-subgraph canvas
 * operations that the UI exposes through BuildPlanDialog, CloneTrajectoryDialog,
 * and the action-badge pipeline menu.
 *
 * One tool, three kinds:
 *   • build   — reverse-DAG from a target draft. Seed runRequested + cascadeToken
 *               on every incomplete ancestor draft; immediately adopt any whose
 *               upstream refs are already completed. Browser-side cascade runner
 *               (apps/web/app/hooks/useCascadeRunner.ts) finishes the rest as
 *               upstream outputs resolve.
 *   • clone   — forward BFS from a leaf. Classify into heads (reused-as-is copies
 *               of uploads / hand-placed data) and cloneset (action-badges +
 *               intermediate outputs, reset to draft). Fork them all under fresh
 *               IDs, stacked below the original bounding box.
 *   • adopt   — single-draft promotion. Read the upstream action-badge's live
 *               state, compute the pending payload, write it onto the draft.
 *
 * Defaults to dry-run: the tool returns a plan without mutating unless
 * `apply: true` is passed. Matches the dialog confirmation flow in the UI.
 *
 * Ported algorithms (kept in sync with):
 *   apps/web/app/components/nodes/buildPlan.ts
 *   apps/web/app/components/nodes/trajectoryPlan.ts
 *   apps/web/app/components/nodes/performAdoption.ts
 */

import { z } from "zod";
import { tool } from "ai";
import type { LoroDoc } from "loro-crdt";
import {
  Canvas,
  MODEL_CARDS,
  validateGenerationInput,
  parsePromptParts,
  extractPromptText,
  composePromptWithTextRefs,
  resolveAspectRatio,
  partitionRefs,
  type BroadcastFn,
  type NodeInfo,
} from "@clash/shared-types";
import { log } from "../../logger";

// ─── Edge helpers (Canvas.listEdges drops IDs; we need them for clone) ───

export interface EdgeWithId {
  id: string;
  source: string;
  target: string;
  type?: string;
}

function listEdgesWithIds(doc: LoroDoc): EdgeWithId[] {
  const edgesMap = doc.getMap("edges");
  const out: EdgeWithId[] = [];
  for (const [id, raw] of edgesMap.entries()) {
    const r = raw as Record<string, any>;
    if (r.source && r.target) out.push({ id, source: r.source, target: r.target, type: r.type });
  }
  return out;
}

function buildIncomingIndex(edges: EdgeWithId[]): Map<string, EdgeWithId[]> {
  const m = new Map<string, EdgeWithId[]>();
  for (const e of edges) {
    const list = m.get(e.target);
    if (list) list.push(e);
    else m.set(e.target, [e]);
  }
  return m;
}

function isDraftStatus(s: unknown): boolean {
  return s === "draft" || s === "idle";
}

function extractLabelFromPrompt(src: string, fallback: string): string {
  if (!src || !src.trim()) return fallback;
  const lines = src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l !== "Prompt" && l !== "Enter your prompt here...");
  if (lines.length === 0) return fallback;
  const first = lines[0];
  return first.length > 50 ? first.slice(0, 50) + "..." : first;
}

// ─── Build plan (reverse DAG from target draft) ──────────────────────────

export interface BuildPlanEntry {
  draftId: string;
  actionId: string | null;
  modelId: string | null;
  modelName: string;
  modality: "image" | "video" | "audio" | "text";
  label: string;
  hasPrompt: boolean;
  /** True iff every ref of the upstream action is already status:'completed'. */
  readyToAdopt: boolean;
}

export interface BuildPlan {
  entries: BuildPlanEntry[];
  blockers: string[];
  warnings: string[];
  cycle: boolean;
}

export function computeBuildPlan(targetId: string, nodes: NodeInfo[], edges: EdgeWithId[]): BuildPlan {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incoming = buildIncomingIndex(edges);

  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const orderedDraftIds: string[] = [];
  let cycle = false;

  const dfs = (nodeId: string): void => {
    if (cycle) return;
    if (inProgress.has(nodeId)) {
      cycle = true;
      return;
    }
    if (visited.has(nodeId)) return;

    inProgress.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) {
      inProgress.delete(nodeId);
      visited.add(nodeId);
      return;
    }

    const status = node.data?.status;
    const isDraft = node.type !== "action-badge" && isDraftStatus(status);
    const isAction = node.type === "action-badge";

    if (isAction || isDraft) {
      const ins = incoming.get(nodeId) ?? [];
      for (const e of ins) dfs(e.source);
      if (cycle) {
        inProgress.delete(nodeId);
        return;
      }
      if (isDraft) orderedDraftIds.push(nodeId);
    }

    inProgress.delete(nodeId);
    visited.add(nodeId);
  };

  dfs(targetId);

  if (cycle) {
    return { entries: [], blockers: ["Cycle detected in dependency graph."], warnings: [], cycle: true };
  }

  const entries: BuildPlanEntry[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const draftId of orderedDraftIds) {
    const draft = nodeMap.get(draftId);
    if (!draft) continue;

    const draftIncoming = incoming.get(draftId) ?? [];
    const actionEdge = draftIncoming.find((e) => nodeMap.get(e.source)?.type === "action-badge");
    const action = actionEdge ? nodeMap.get(actionEdge.source) : undefined;
    const actionData = action?.data ?? {};

    const modelId = (actionData.modelId as string | undefined) ?? null;
    const modelName = modelId ? MODEL_CARDS.find((c) => c.id === modelId)?.name ?? modelId : "Unknown";

    const rawLabel = (draft.data.label as string | undefined) ?? draft.id;
    const label = rawLabel.trim() || draft.id;

    const rawPrompt =
      ((actionData.content as string | undefined) ?? "") || ((actionData.prompt as string | undefined) ?? "");
    const hasPrompt = rawPrompt.trim().length > 0;

    const modality =
      draft.type === "video" || draft.type === "audio" || draft.type === "text"
        ? (draft.type as "video" | "audio" | "text")
        : "image";

    let readyToAdopt = false;
    if (action) {
      const refs = incoming.get(action.id) ?? [];
      readyToAdopt = refs.every((e) => (nodeMap.get(e.source)?.data?.status) === "completed");
    }

    entries.push({
      draftId,
      actionId: action?.id ?? null,
      modelId,
      modelName,
      modality,
      label,
      hasPrompt,
      readyToAdopt,
    });

    if (!action) {
      warnings.push(`"${label}" has no upstream action — skipped at run time.`);
      continue;
    }
    if (!modelId) blockers.push(`"${label}": no model selected on upstream action.`);
    if (!hasPrompt) blockers.push(`"${label}": upstream action has no prompt.`);
  }

  if (entries.length === 0 && !cycle) {
    warnings.push("Nothing to build — target is not a draft (or already satisfied).");
  }

  return { entries, blockers, warnings, cycle: false };
}

// ─── Adoption payload (port of performAdoption.ts) ───────────────────────

export interface AdoptionResult {
  ok: boolean;
  type?: "image" | "video" | "audio" | "text";
  data?: Record<string, unknown>;
  error?: string;
}

export function computeAdoptionPayload(
  actionBadge: NodeInfo,
  allNodes: NodeInfo[],
  allEdges: EdgeWithId[],
): AdoptionResult {
  const d = actionBadge.data ?? {};
  const actionType = (d.actionType as string) || "image-gen";
  const isCustom = actionType.startsWith("custom:");
  if (isCustom) {
    return { ok: false, error: "Custom actions not yet supported by workflow_op (browser-only for now)." };
  }

  const content = (d.content as string) || "";
  const dataPrompt = (d.prompt as string) || "";
  const rawPrompt = (content && content.trim() !== "" ? content : "") || dataPrompt || "";

  const modelId = (d.modelId as string) || "nano-banana-2";
  const modelParams = (d.modelParams as Record<string, string | number | boolean>) || {};
  const selectedModel = MODEL_CARDS.find((c) => c.id === modelId);

  // Partition refs from incoming edges using the shared capability helper.
  // Single source of truth with frontend (useSpawnPendingAsset, performAdoption).
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const refEdges = allEdges.filter((e) => e.target === actionBadge.id);
  const refNodes = refEdges
    .map((e) => nodeById.get(e.source))
    .filter((n): n is NodeInfo => !!n);
  const {
    texts: refTexts,
    imageAssetIds: refImgAssetIds,
    videoAssetIds: refVidAssetIds,
    audioAssetIds: refAudAssetIds,
  } = selectedModel
    ? partitionRefs(refNodes, selectedModel)
    : { texts: [], imageAssetIds: [], videoAssetIds: [], audioAssetIds: [] };

  const prompt = composePromptWithTextRefs(rawPrompt, refTexts);
  if (!prompt.trim()) return { ok: false, error: "No prompt on upstream action-badge." };
  const promptParts = parsePromptParts(prompt);
  const promptText = extractPromptText(promptParts);

  if (selectedModel) {
    const err = validateGenerationInput({
      prompt: promptText,
      referenceTextSnippets: refTexts,
      referenceImageAssetIds: refImgAssetIds,
      referenceVideoAssetIds: refVidAssetIds,
      referenceAudioAssetIds: refAudAssetIds,
      modelCard: selectedModel,
    });
    if (err) return { ok: false, error: err };
  }

  // Pending media nodes carry assetIds only — server resolves R2 keys
  // via D1. node.data.src is intentionally omitted (was a stale legacy
  // mirror that caused refs to drop silently when only assetId was set).

  if (actionType === "image-gen") {
    return {
      ok: true,
      type: "image",
      data: {
        label: extractLabelFromPrompt(promptText, "Generated Image"),
        status: "pending",
        prompt: promptText,
        referenceImageAssetIds: refImgAssetIds,
        aspectRatio: resolveAspectRatio(modelId, modelParams),
        model: modelId,
        modelId,
        modelParams: { ...modelParams, count: 1 },
      },
    };
  }

  if (actionType === "video-gen") {
    const dur = modelParams.duration ?? 5;
    const duration = typeof dur === "string" ? parseInt(dur as string, 10) : Number(dur) || 5;
    return {
      ok: true,
      type: "video",
      data: {
        label: extractLabelFromPrompt(promptText, "Generated Video"),
        status: "pending",
        prompt: promptText,
        referenceImageAssetIds: refImgAssetIds,
        referenceVideoAssetIds: refVidAssetIds,
        referenceAudioAssetIds: refAudAssetIds,
        duration,
        model: modelId,
        modelId,
        modelParams,
        aspectRatio: resolveAspectRatio(modelId, modelParams),
      },
    };
  }

  if (actionType === "audio-gen") {
    return {
      ok: true,
      type: "audio",
      data: {
        label: extractLabelFromPrompt(promptText, "Generated Audio"),
        status: "pending",
        prompt: promptText,
        model: modelId,
        modelId,
        modelParams,
      },
    };
  }

  if (actionType === "text-gen") {
    return {
      ok: true,
      type: "text",
      data: {
        label: extractLabelFromPrompt(promptText, "Generated Text"),
        content: "",
        status: "pending",
        prompt: promptText,
        referenceImageAssetIds: refImgAssetIds,
        referenceVideoAssetIds: refVidAssetIds,
        referenceAudioAssetIds: refAudAssetIds,
        model: modelId,
        modelId,
        modelParams,
      },
    };
  }

  return { ok: false, error: `Unsupported actionType: ${actionType}` };
}

// ─── Trajectory (forward BFS from leaf) ──────────────────────────────────

export interface TrajectorySubgraph {
  nodeIds: Set<string>;
  headIds: Set<string>;
  target: string;
  previewEdges: EdgeWithId[];
}

export function computeTrajectory(leafId: string, nodes: NodeInfo[], edges: EdgeWithId[]): TrajectorySubgraph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incoming = buildIncomingIndex(edges);

  const hasActionParent = (id: string) =>
    (incoming.get(id) ?? []).some((e) => nodeMap.get(e.source)?.type === "action-badge");

  const nodeIds = new Set<string>([leafId]);
  const headIds = new Set<string>();
  const queue = [leafId];

  if (!hasActionParent(leafId)) headIds.add(leafId);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of incoming.get(cur) ?? []) {
      const parent = nodeMap.get(e.source);
      if (!parent) continue;
      if (nodeIds.has(parent.id)) continue;
      nodeIds.add(parent.id);
      if (parent.type === "action-badge") {
        queue.push(parent.id);
      } else if (hasActionParent(parent.id)) {
        queue.push(parent.id);
      } else {
        headIds.add(parent.id);
      }
    }
  }

  const previewEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return { nodeIds, headIds, target: leafId, previewEdges };
}

/**
 * Simulate severing an action's output edges from the trajectory and recompute
 * the reachable subgraph from `target`. Ports CloneTrajectoryDialog's drop logic.
 *
 * Returns `null` if the drop is invalid (would leave an action-badge or
 * incomplete draft as a root of the resulting clone — ports the UI's deletable
 * invariant). Otherwise returns the pruned subgraph + the new head IDs that
 * emerged from the dropped stages' outputs.
 */
export function simulateDrop(
  sub: TrajectorySubgraph,
  dropActionIds: Set<string>,
  nodes: NodeInfo[],
  edges: EdgeWithId[],
): { pruned: TrajectorySubgraph; newHeads: string[] } | { error: string } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = buildIncomingIndex(edges);

  // Reverse BFS from target, skipping edges whose source is a dropped action.
  const keep = new Set<string>([sub.target]);
  const queue = [sub.target];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of incoming.get(cur) ?? []) {
      if (dropActionIds.has(e.source)) continue;
      if (keep.has(e.source)) continue;
      keep.add(e.source);
      queue.push(e.source);
    }
  }

  // Validate: any node with no incoming edges in the pruned graph must be
  // a completed data node (not an action, not a draft).
  const rootsToPromote: string[] = [];
  for (const id of keep) {
    const ins = incoming.get(id) ?? [];
    const keptIncoming = ins.filter((e) => !dropActionIds.has(e.source) && keep.has(e.source));
    if (keptIncoming.length > 0) continue;
    // No incoming → would be a root in the clone.
    const n = nodeById.get(id);
    if (!n) continue;
    if (n.type === "action-badge") {
      return { error: `Dropping leaves action-badge ${id} as a root (actions need inputs).` };
    }
    const status = n.data?.status as string | undefined;
    if (status !== "completed") {
      return { error: `Dropping would leave ${id} (status=${status ?? "unknown"}) as a root — must be completed.` };
    }
    // It's a valid root. If this node was originally NOT a head (was a
    // cloneset output), it just got promoted → emit as newHead.
    if (!sub.headIds.has(id)) rootsToPromote.push(id);
  }

  const newHeadIds = new Set<string>([...sub.headIds].filter((h) => keep.has(h)));
  for (const id of rootsToPromote) newHeadIds.add(id);

  const prunedEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));

  return {
    pruned: { nodeIds: keep, headIds: newHeadIds, target: sub.target, previewEdges: prunedEdges },
    newHeads: rootsToPromote,
  };
}

/**
 * For each action-badge in the trajectory, test droppability in isolation
 * and report what its output would become. Powers the clone dry-run so the
 * agent can pick valid `drop_action_ids` without guessing.
 */
export interface ActionReport {
  actionId: string;
  outputNodeId: string | null;
  droppable: boolean;
  reason: string | null;
}
export function describeActions(
  sub: TrajectorySubgraph,
  nodes: NodeInfo[],
  edges: EdgeWithId[],
): ActionReport[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const reports: ActionReport[] = [];
  for (const id of sub.nodeIds) {
    const n = nodeById.get(id);
    if (!n || n.type !== "action-badge") continue;
    // Output node = the single outgoing edge target within the subgraph.
    const outEdge = edges.find((e) => e.source === id && sub.nodeIds.has(e.target));
    const outputNodeId = outEdge?.target ?? null;

    const result = simulateDrop(sub, new Set([id]), nodes, edges);
    if ("error" in result) {
      reports.push({ actionId: id, outputNodeId, droppable: false, reason: result.error });
    } else {
      reports.push({ actionId: id, outputNodeId, droppable: true, reason: null });
    }
  }
  return reports;
}

// ─── Apply: Build ────────────────────────────────────────────────────────

interface ApplyBuildResult {
  cascadeToken: string;
  seeded: string[];
  adoptedNow: string[];
  failed: Array<{ draftId: string; error: string }>;
}

function applyBuild(
  canvas: Canvas,
  doc: LoroDoc,
  plan: BuildPlan,
  generateId: () => string,
): ApplyBuildResult {
  const cascadeToken = generateId();
  const seeded: string[] = [];
  const adoptedNow: string[] = [];
  const failed: Array<{ draftId: string; error: string }> = [];

  // Re-read once; Canvas.updateNode merges into existing data.
  const allNodes = canvas.listNodes();
  const allEdges = listEdgesWithIds(doc);
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  for (const entry of plan.entries) {
    if (!entry.actionId) continue; // no upstream → nothing to seed
    if (entry.readyToAdopt) {
      // Skip seed — adopt directly.
      const action = nodeById.get(entry.actionId);
      if (!action) {
        failed.push({ draftId: entry.draftId, error: "Upstream action not found." });
        continue;
      }
      const result = computeAdoptionPayload(action, allNodes, allEdges);
      if (!result.ok || !result.data) {
        failed.push({ draftId: entry.draftId, error: result.error ?? "adoption failed" });
        continue;
      }
      const payload = { ...result.data, cascadeToken, runRequested: false };
      canvas.updateNode(entry.draftId, payload);
      adoptedNow.push(entry.draftId);
    } else {
      canvas.updateNode(entry.draftId, { runRequested: true, cascadeToken });
      seeded.push(entry.draftId);
    }
  }

  return { cascadeToken, seeded, adoptedNow, failed };
}

// ─── Apply: Clone ────────────────────────────────────────────────────────

interface ApplyCloneResult {
  createdNodeIds: string[];
  createdEdgeIds: string[];
  idMap: Record<string, string>;
}

function applyClone(
  canvas: Canvas,
  doc: LoroDoc,
  subgraph: TrajectorySubgraph,
  generateId: () => string,
): ApplyCloneResult {
  const allNodes = canvas.listNodes();
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  // Compute Y offset — stack below original bounding box.
  let top = Infinity;
  let bottom = -Infinity;
  for (const id of subgraph.nodeIds) {
    const n = nodeById.get(id);
    if (!n) continue;
    const y = n.position?.y ?? 0;
    const h = typeof n.height === "number" ? n.height : 0;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + (h || 300));
  }
  const yOffset = top === Infinity ? 400 : bottom - top + 80;

  const idMap = new Map<string, string>();
  for (const id of subgraph.nodeIds) idMap.set(id, generateId());

  const draftStatusTypes = new Set(["image", "video", "audio", "text"]);
  const createdNodeIds: string[] = [];

  for (const oldId of subgraph.nodeIds) {
    const old = nodeById.get(oldId);
    if (!old) continue;
    const newId = idMap.get(oldId)!;

    const nextData: Record<string, unknown> = { ...(old.data ?? {}) };
    // Strip run-state regardless of role — tied to old execution, not content.
    delete nextData.runRequested;
    delete nextData.cascadeToken;
    delete nextData.cascadeCancel;
    delete nextData.cascadePropagated;
    delete nextData.failureReason;
    delete nextData.openPanel;

    if (subgraph.headIds.has(oldId)) {
      // Head: retain content verbatim (src/assetId/etc). Clear hasRun defensively.
      delete nextData.hasRun;
    } else if (old.type === "action-badge") {
      delete nextData.hasRun;
      delete nextData.preAllocatedAssetId;
      delete nextData.status;
      delete nextData.referenceImageOrder;
    } else if (old.type && draftStatusTypes.has(old.type)) {
      nextData.status = "draft";
      delete nextData.assetId;
      delete nextData.taskId;
      delete nextData.description;
      delete nextData.naturalWidth;
      delete nextData.naturalHeight;
      delete nextData.poster;
      delete nextData.coverUrl;
      delete nextData.thumbnail;
    }

    const newPos = {
      x: old.position?.x ?? 0,
      y: (old.position?.y ?? 0) + yOffset,
    };
    canvas.insertNode(newId, old.type, nextData, old.parent_id ?? null, newPos);
    createdNodeIds.push(newId);
  }

  const createdEdgeIds: string[] = [];
  for (const e of subgraph.previewEdges) {
    const newSource = idMap.get(e.source);
    const newTarget = idMap.get(e.target);
    if (!newSource || !newTarget) continue;
    const newEdgeId = `${newSource}-${newTarget}-${generateId().slice(0, 6)}`;
    canvas.insertEdge(newEdgeId, newSource, newTarget, e.type ?? "default");
    createdEdgeIds.push(newEdgeId);
  }

  return { createdNodeIds, createdEdgeIds, idMap: Object.fromEntries(idMap) };
}

// ─── Apply: Adopt ────────────────────────────────────────────────────────

interface ApplyAdoptResult {
  draftId: string;
  adopted: boolean;
  error?: string;
}

function applyAdopt(canvas: Canvas, doc: LoroDoc, draftId: string): ApplyAdoptResult {
  const allNodes = canvas.listNodes();
  const allEdges = listEdgesWithIds(doc);
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const draft = nodeById.get(draftId);
  if (!draft) return { draftId, adopted: false, error: "Draft not found." };
  if (!isDraftStatus(draft.data?.status)) {
    return { draftId, adopted: false, error: `Node ${draftId} is not a draft (status=${draft.data?.status}).` };
  }

  const incoming = buildIncomingIndex(allEdges);
  const draftIncoming = incoming.get(draftId) ?? [];
  const actionEdge = draftIncoming.find((e) => nodeById.get(e.source)?.type === "action-badge");
  const action = actionEdge ? nodeById.get(actionEdge.source) : undefined;
  if (!action) return { draftId, adopted: false, error: "No upstream action-badge." };

  // Gate: all upstream refs of the action must be completed.
  const refs = incoming.get(action.id) ?? [];
  for (const e of refs) {
    const src = nodeById.get(e.source);
    if ((src?.data?.status) !== "completed") {
      return { draftId, adopted: false, error: `Ref ${e.source} not completed (status=${src?.data?.status}).` };
    }
  }

  const result = computeAdoptionPayload(action, allNodes, allEdges);
  if (!result.ok || !result.data) {
    return { draftId, adopted: false, error: result.error ?? "adoption failed" };
  }

  canvas.updateNode(draftId, { ...result.data, runRequested: false });
  return { draftId, adopted: true };
}

// ─── Tool factory ────────────────────────────────────────────────────────

export function createWorkflowTools(doc: LoroDoc, broadcast: BroadcastFn, generateId: () => string) {
  const canvas = new Canvas(doc, broadcast);

  const workflowOp = tool({
    description:
      "Plan or execute a whole-subgraph canvas operation. Three kinds:\n" +
      "• build — reverse-DAG from a target draft. Finds all incomplete ancestors that must run " +
      "to materialize the target. apply=true seeds them with runRequested + cascadeToken " +
      "(browser cascade runner adopts each when its upstream refs complete) and immediately " +
      "adopts any whose refs are already completed.\n" +
      "• clone — forward BFS from a leaf. Classifies nodes into heads (reused verbatim) and " +
      "cloneset (action-badges + outputs, reset to draft). apply=true forks the whole subgraph " +
      "under fresh IDs so the original trajectory is untouched. Optional `drop_action_ids` " +
      "lets you cut off earlier stages — for each listed action-badge, that action plus any " +
      "ancestor that ONLY feeds it is pruned; the action's output becomes a head (its " +
      "completed asset is reused as-is). Use this to start the clone mid-pipeline. The clone " +
      "dry-run enumerates every action with a `droppable` flag so you can pick valid IDs.\n" +
      "• adopt — promote one draft to pending now. Fails if the upstream action-badge's refs " +
      "aren't all completed yet.\n" +
      "Defaults to dry-run (apply=false): returns the plan without mutating so you can confirm.",
    inputSchema: z.object({
      kind: z.enum(["build", "clone", "adopt"]).describe(
        "build: seed/run a chain of drafts ending at a target. " +
          "clone: fork a leaf's full production trajectory. " +
          "adopt: flip one ready draft to pending.",
      ),
      target_node_id: z.string().describe(
        "build: target draft node ID. clone: leaf node ID. adopt: draft node ID to promote.",
      ),
      apply: z
        .boolean()
        .optional()
        .describe("Default false (preview only). Set true to actually mutate the canvas."),
      drop_action_ids: z
        .array(z.string())
        .optional()
        .describe(
          "clone only. Action-badge IDs to prune from the trajectory before cloning. " +
            "Each dropped action's output node is promoted to head (completed asset reused). " +
            "Dropping an action whose output would leave an incomplete draft as a clone root " +
            "is rejected — check `droppable` in the dry-run first.",
        ),
    }),
    execute: async (args) => {
      const { kind, target_node_id, apply = false, drop_action_ids } = args;
      try {
        const nodes = canvas.listNodes();
        const edges = listEdgesWithIds(doc);

        if (kind === "build") {
          const target = nodes.find((n) => n.id === target_node_id);
          if (!target) return `Error: target ${target_node_id} not found.`;

          const plan = computeBuildPlan(target_node_id, nodes, edges);
          if (!apply) {
            return JSON.stringify(
              {
                kind: "build",
                applied: false,
                target: target_node_id,
                cycle: plan.cycle,
                blockers: plan.blockers,
                warnings: plan.warnings,
                entries: plan.entries.map((e) => ({
                  draftId: e.draftId,
                  label: e.label,
                  modality: e.modality,
                  model: e.modelName,
                  hasPrompt: e.hasPrompt,
                  readyToAdopt: e.readyToAdopt,
                })),
                hint:
                  plan.blockers.length > 0
                    ? "Has blockers — fix before apply=true."
                    : plan.entries.length === 0
                      ? "Nothing to build."
                      : "Re-call with apply=true to seed/adopt.",
              },
              null,
              2,
            );
          }

          if (plan.cycle) return "Error: cycle detected, cannot apply build plan.";
          if (plan.blockers.length > 0) {
            return `Cannot apply: blockers present:\n- ${plan.blockers.join("\n- ")}`;
          }
          if (plan.entries.length === 0) return "Nothing to build — target is not a draft.";

          const result = applyBuild(canvas, doc, plan, generateId);
          log.info("workflow_op build applied", {
            target: target_node_id,
            seeded: result.seeded.length,
            adoptedNow: result.adoptedNow.length,
            failed: result.failed.length,
          });
          return JSON.stringify(
            {
              kind: "build",
              applied: true,
              target: target_node_id,
              cascadeToken: result.cascadeToken,
              seeded: result.seeded,
              adoptedNow: result.adoptedNow,
              failed: result.failed,
              note:
                "Drafts in `seeded` have runRequested=true; they adopt automatically as their upstream completes. " +
                "Use wait_for_generation on the target to wait for the full chain.",
            },
            null,
            2,
          );
        }

        if (kind === "clone") {
          const target = nodes.find((n) => n.id === target_node_id);
          if (!target) return `Error: target ${target_node_id} not found.`;

          const baseSub = computeTrajectory(target_node_id, nodes, edges);

          // Apply drops (if any) BEFORE reporting / cloning. Each unknown or
          // undroppable ID fails the call — the agent is expected to have
          // consulted the dry-run's `actions` list.
          let sub = baseSub;
          let newHeadsFromDrops: string[] = [];
          if (drop_action_ids && drop_action_ids.length > 0) {
            for (const id of drop_action_ids) {
              if (!baseSub.nodeIds.has(id)) {
                return `Error: drop_action_id ${id} is not in the trajectory of ${target_node_id}.`;
              }
              const n = nodes.find((x) => x.id === id);
              if (n?.type !== "action-badge") {
                return `Error: drop_action_id ${id} is not an action-badge (type=${n?.type ?? "missing"}).`;
              }
            }
            const result = simulateDrop(baseSub, new Set(drop_action_ids), nodes, edges);
            if ("error" in result) return `Error: ${result.error}`;
            sub = result.pruned;
            newHeadsFromDrops = result.newHeads;
          }

          const clonesetCount = sub.nodeIds.size - sub.headIds.size;
          const actionReports = describeActions(baseSub, nodes, edges);

          if (!apply) {
            return JSON.stringify(
              {
                kind: "clone",
                applied: false,
                target: target_node_id,
                totalNodes: sub.nodeIds.size,
                heads: Array.from(sub.headIds),
                cloneset: Array.from(sub.nodeIds).filter((id) => !sub.headIds.has(id)),
                actions: actionReports,
                dropsApplied: drop_action_ids ?? [],
                newHeadsFromDrops,
                hint:
                  clonesetCount === 0
                    ? "Nothing to clone — target has no action-badge ancestry (it's a root head)."
                    : drop_action_ids && drop_action_ids.length > 0
                      ? "Drops validated. Re-call with apply=true to fork this pruned subgraph."
                      : "Re-call with apply=true to fork. Pass drop_action_ids=[...] to prune stages first (see `actions`).",
              },
              null,
              2,
            );
          }

          if (clonesetCount === 0) {
            return "Nothing to clone — target is a root head, not a generated output.";
          }

          const result = applyClone(canvas, doc, sub, generateId);
          log.info("workflow_op clone applied", {
            target: target_node_id,
            created: result.createdNodeIds.length,
            edges: result.createdEdgeIds.length,
            drops: drop_action_ids?.length ?? 0,
          });
          return JSON.stringify(
            {
              kind: "clone",
              applied: true,
              target: target_node_id,
              newLeafId: result.idMap[target_node_id],
              createdNodes: result.createdNodeIds,
              createdEdges: result.createdEdgeIds,
              idMap: result.idMap,
              dropsApplied: drop_action_ids ?? [],
              newHeadsFromDrops,
              note:
                "Heads retain their assets; non-heads are fresh drafts. Build the new leaf to run the cloned workflow.",
            },
            null,
            2,
          );
        }

        // kind === "adopt"
        const target = nodes.find((n) => n.id === target_node_id);
        if (!target) return `Error: target ${target_node_id} not found.`;
        if (!isDraftStatus(target.data?.status)) {
          return `Error: ${target_node_id} is not a draft (status=${target.data?.status}).`;
        }

        const incoming = buildIncomingIndex(edges);
        const nodeById = new Map(nodes.map((n) => [n.id, n]));
        const actionEdge = (incoming.get(target_node_id) ?? []).find(
          (e) => nodeById.get(e.source)?.type === "action-badge",
        );
        const action = actionEdge ? nodeById.get(actionEdge.source) : undefined;
        if (!action) return `Error: draft ${target_node_id} has no upstream action-badge.`;

        const refs = incoming.get(action.id) ?? [];
        const refStatuses = refs.map((e) => ({
          id: e.source,
          status: (nodeById.get(e.source)?.data?.status as string | undefined) ?? "missing",
        }));
        const allReady = refStatuses.every((r) => r.status === "completed");

        const preview = computeAdoptionPayload(action, nodes, edges);

        if (!apply) {
          return JSON.stringify(
            {
              kind: "adopt",
              applied: false,
              draftId: target_node_id,
              actionId: action.id,
              allRefsReady: allReady,
              refs: refStatuses,
              payloadPreviewOk: preview.ok,
              payloadError: preview.error ?? null,
              payloadType: preview.type ?? null,
              hint: !allReady
                ? "Upstream refs not all completed — use kind=build instead to seed the chain."
                : !preview.ok
                  ? `Blocked: ${preview.error}`
                  : "Re-call with apply=true to adopt.",
            },
            null,
            2,
          );
        }

        const result = applyAdopt(canvas, doc, target_node_id);
        log.info("workflow_op adopt applied", result);
        return JSON.stringify({ kind: "adopt", applied: true, ...result }, null, 2);
      } catch (e) {
        log.error(`workflow_op error (${kind})`, e);
        return `Error in workflow_op(${kind}): ${e}`;
      }
    },
  });

  return { workflow_op: workflowOp };
}
