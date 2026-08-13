import type { Node as RFNode, Edge } from "@xyflow/react";
import {
  parsePromptParts,
  extractPromptText,
  composePromptWithTextRefs,
  resolveAspectRatio,
  validateGenerationInput,
  partitionRefs,
  MODEL_CARDS,
  type CustomActionDefinition,
} from "@clash/shared-types";

export interface ComputeAdoptionInput {
  actionBadgeNode: RFNode;
  nodes: RFNode[];
  edges: Edge[];
  customActions: CustomActionDefinition[];
}

export interface ComputeAdoptionOutput {
  ok: boolean;
  type?: "image" | "video" | "audio" | "text";
  data?: Record<string, unknown>;
  error?: string;
}

function extractLabel(src: string, fallback: string): string {
  if (!src || !src.trim()) return fallback;
  const lines = src
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("#") &&
        l !== "Prompt" &&
        l !== "Enter your prompt here...",
    );
  if (lines.length === 0) return fallback;
  const first = lines[0];
  return first.length > 50 ? first.slice(0, 50) + "..." : first;
}

/**
 * Compute the payload for turning a draft (status:'idle') into a pending run
 * (status:'pending'). Reads the action-badge's CURRENT state — prompt, model,
 * params, and stable Asset references partitioned from its incoming edges. Crucially
 * re-resolves refs on every call so that cascade adoption picks up freshly
 * completed upstream outputs (the whole reason draft → pending exists).
 *
 * Pure — no React Flow / Loro mutations. Caller is responsible for applying
 * the returned data via setNodes + loroSync.updateNode.
 */
export function computeAdoption({
  actionBadgeNode,
  nodes,
  edges,
  customActions,
}: ComputeAdoptionInput): ComputeAdoptionOutput {
  const d = (actionBadgeNode.data ?? {}) as Record<string, unknown>;
  const actionType = (d.actionType as string) || "image-gen";
  const isCustom = actionType.startsWith("custom:");
  const customActionId = isCustom ? actionType.replace("custom:", "") : null;
  const customDef = customActionId
    ? customActions.find((a) => a.id === customActionId)
    : undefined;

  if (isCustom && !customDef)
    return { ok: false, error: "Custom action not loaded" };

  const content = (d.content as string) || "";
  const dataPrompt = (d.prompt as string) || "";
  const rawPrompt =
    (content && content.trim() !== "" ? content : "") || dataPrompt || "";

  const modelId = (d.modelId as string) || "nano-banana-2";
  const modelParams =
    (d.modelParams as Record<string, string | number | boolean>) || {};
  const selectedModel = MODEL_CARDS.find((c) => c.id === modelId);
  const customActionParams =
    (d.customActionParams as Record<string, string | number | boolean>) || {};

  // Partition refs from live incoming edges. partitionRefs filters by what
  // selectedModel accepts and reads stable Asset ids — single source of
  // truth shared with ActionBadge / useSpawnPendingAsset / agent workflow.
  const refEdges = edges.filter((e) => e.target === actionBadgeNode.id);
  const refNodes = refEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is RFNode => !!n);
  const {
    texts: refTexts,
    imageAssetIds: refImgAssetIds,
    videoAssetIds: refVidAssetIds,
    audioAssetIds: refAudAssetIds,
  } = selectedModel
    ? partitionRefs(refNodes, selectedModel)
    : { texts: [], imageAssetIds: [], videoAssetIds: [], audioAssetIds: [] };

  const prompt = composePromptWithTextRefs(rawPrompt, refTexts);
  if (!prompt.trim()) return { ok: false, error: "No prompt" };
  const promptParts = parsePromptParts(prompt);
  const promptText = extractPromptText(promptParts);

  if (!isCustom && selectedModel) {
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

  if (isCustom && customDef) {
    const outputType = customDef.outputType || "image";
    const type = (outputType === "text" ? "text" : outputType) as
      "image" | "video" | "audio" | "text";
    const data: Record<string, unknown> = {
      label: extractLabel(prompt, `${customDef.name} Result`),
      status: "pending",
      actionType,
      customActionId: customDef.id,
      customActionParams,
      ...(customDef.pluginBinding
        ? { pluginBinding: customDef.pluginBinding }
        : {}),
      prompt,
      outputType,
    };
    return { ok: true, type, data };
  }

  // Pending media nodes intentionally omit media projections — see
  // useSpawnPendingAsset for the same contract: Project Asset ids are the
  // source of truth and the Host resolves Resources.

  if (actionType === "image-gen") {
    return {
      ok: true,
      type: "image",
      data: {
        label: extractLabel(promptText, "Generated Image"),
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
    const duration =
      typeof dur === "string" ? parseInt(dur, 10) : Number(dur) || 5;
    return {
      ok: true,
      type: "video",
      data: {
        label: extractLabel(promptText, "Generated Video"),
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
        label: extractLabel(promptText, "Generated Audio"),
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
        label: extractLabel(promptText, "Generated Text"),
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
