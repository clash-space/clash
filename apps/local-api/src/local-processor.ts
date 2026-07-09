import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoroDoc } from "loro-crdt";
import type { Asset, AssetKind } from "@clash/shared-types/assets";
import { createMockExternalAigcService, type ExternalAigcService } from "./local-aigc.js";
import { createLocalMetadataStore, type LocalDb } from "./local-metadata-store.js";

export interface LocalWorkflowProcessorInput {
  doc: LoroDoc;
  projectId: string;
  broadcastJson?: (msg: Record<string, unknown>) => void;
}

export interface LocalWorkflowProcessor {
  process(input: LocalWorkflowProcessorInput): Promise<boolean>;
}

export interface LocalWorkflowProcessorOptions {
  dataDir: string;
  userId?: string;
  aigc?: ExternalAigcService;
}

type ProcessableKind = Extract<AssetKind, "image" | "video" | "audio">;

function sanitizeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function modelParams(data: Record<string, unknown>): Record<string, unknown> {
  const params = data.modelParams;
  return params && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

function stringParam(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key] ?? modelParams(data)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key] ?? modelParams(data)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/s$/i, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function promptFromData(data: Record<string, unknown>, fallback: string): string {
  return typeof data.prompt === "string" && data.prompt.trim()
    ? data.prompt
    : typeof data.label === "string" && data.label.trim()
      ? data.label
      : fallback;
}

function modelFromData(data: Record<string, unknown>, fallback: string): string {
  return typeof data.modelId === "string" && data.modelId.trim()
    ? data.modelId
    : typeof data.model === "string" && data.model.trim()
      ? data.model
      : fallback;
}

function aspectRatioFromData(data: Record<string, unknown>): string | undefined {
  return stringParam(data, "aspectRatio") ?? stringParam(data, "aspect_ratio");
}

function durationFromData(data: Record<string, unknown>, fallback: number): number {
  return Math.max(1, Math.min(30, numberParam(data, "duration") ?? fallback));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function resolveStorageKeys(db: LocalDb, projectId: string, assetIds: string[]): string[] {
  const keys: string[] = [];
  for (const id of assetIds) {
    const asset = (db.assets ?? []).find((item) => item.id === id && (!item.projectId || item.projectId === projectId));
    if (asset?.srcR2Key) keys.push(asset.srcR2Key);
  }
  return keys;
}

function pendingCustomNode(node: Record<string, any>): {
  actionId: string;
  outputType: ProcessableKind | "text";
} | null {
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  if (typeof data.actionType !== "string" || !data.actionType.startsWith("custom:")) return null;
  if (data.status !== "pending") return null;
  if (data.pendingTask) return null;
  const actionId = typeof data.customActionId === "string" && data.customActionId
    ? data.customActionId
    : data.actionType.slice("custom:".length);
  const outputType = data.outputType === "video" || data.outputType === "audio" || data.outputType === "text"
    ? data.outputType
    : "image";
  return { actionId, outputType };
}

function pendingKindForNode(node: Record<string, any>): ProcessableKind | null {
  if (node.type !== "image" && node.type !== "video" && node.type !== "audio") return null;
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  if (data.assetId) return null;
  if (data.status !== "pending" && data.status !== "generating") return null;

  const kind = node.type as ProcessableKind;
  const expectedActionType = `${kind}-gen`;
  if (data.actionType && data.actionType !== expectedActionType) return null;
  return kind;
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("image/svg")) return ".svg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("video/mp4")) return ".mp4";
  if (contentType.includes("video/webm")) return ".webm";
  if (contentType.includes("audio/wav")) return ".wav";
  if (contentType.includes("audio/mpeg")) return ".mp3";
  return ".bin";
}

async function saveAsset(
  options: {
    dataDir: string;
    userId: string;
    projectId: string;
    taskId: string;
    kind: ProcessableKind;
    nodeData: Record<string, unknown>;
    bytes: Uint8Array;
    contentType: string;
    width?: number;
    height?: number;
    durationMs?: number;
    waveform?: number[];
    transcript?: string;
    requestId?: string;
    provider?: string;
    modelEndpoint?: string;
    remoteUrl?: string;
  },
): Promise<Asset> {
  const extension = extensionForContentType(options.contentType);
  const storageKey = `generated/${sanitizeStorageSegment(options.taskId)}${extension}`;
  const assetPath = join(options.dataDir, "assets", storageKey);
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, options.bytes);

  const store = createLocalMetadataStore(options.dataDir);
  const db = await store.load();
  const now = Math.floor(Date.now() / 1000);
  const assetId = `local-asset-${sanitizeStorageSegment(options.taskId)}`;
  const model = modelFromData(options.nodeData, `mock-${options.kind}`);
  const prompt = promptFromData(options.nodeData, `Mock ${options.kind}`);
  const asset: Asset & { projectId?: string } = {
    id: assetId,
    userId: typeof options.nodeData.actorUserId === "string" && options.nodeData.actorUserId
      ? options.nodeData.actorUserId
      : options.userId,
    kind: options.kind,
    srcR2Key: storageKey,
    coverR2Key: null,
    metadata: {
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
      ...(options.durationMs ? { durationMs: options.durationMs } : {}),
      ...(options.waveform ? { waveform: options.waveform } : {}),
      bytes: options.bytes.byteLength,
      contentType: options.contentType,
      mockText: prompt,
      ...(options.transcript ? { transcript: options.transcript } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.modelEndpoint ? { modelEndpoint: options.modelEndpoint } : {}),
      ...(options.remoteUrl ? { remoteUrl: options.remoteUrl } : {}),
    },
    sourceModel: model,
    sourcePrompt: prompt,
    sourceTaskId: options.requestId ?? options.taskId,
    sources: null,
    signedUrl: `/assets/${storageKey}`,
    signedUrlExp: now + 365 * 24 * 60 * 60,
    createdAt: now,
    updatedAt: now,
    projectId: options.projectId,
  };

  db.assets = [
    asset,
    ...(db.assets ?? []).filter((item) => item.id !== asset.id && item.sourceTaskId !== options.taskId),
  ];
  db.assetRefs = [
    {
      assetId: asset.id,
      projectId: options.projectId,
      importedAt: now,
    },
    ...(db.assetRefs ?? []).filter(
      (ref) => !(ref.assetId === asset.id && ref.projectId === options.projectId),
    ),
  ];
  await store.save(db);
  return asset;
}

export function createLocalWorkflowProcessor(
  options: LocalWorkflowProcessorOptions,
): LocalWorkflowProcessor {
  const aigc = options.aigc ?? createMockExternalAigcService();
  const userId = options.userId ?? "local-user";

  return {
    async process(input) {
      const { doc, projectId } = input;
      const nodes = doc.getMap("nodes");
      const tasks = doc.getMap("tasks");
      let changed = false;

      for (const [nodeId, rawNode] of nodes.entries()) {
        const node = rawNode as Record<string, any>;
        const custom = pendingCustomNode(node);
        if (custom) {
          const data = node.data as Record<string, unknown>;
          const actionDef = doc.getMap("customActions").get(custom.actionId) as Record<string, unknown> | undefined;
          if (!actionDef) {
            nodes.set(nodeId, {
              ...node,
              data: {
                ...data,
                status: "failed",
                error: `Custom action not installed: ${custom.actionId}`,
              },
            });
            changed = true;
            continue;
          }

          const db = await createLocalMetadataStore(options.dataDir).load();
          const referenceImageR2Keys = [
            ...stringList(data.referenceImageR2Keys),
            ...resolveStorageKeys(db, projectId, stringList(data.referenceImageAssetIds)),
          ];
          const referenceVideoR2Keys = [
            ...stringList(data.referenceVideoR2Keys),
            ...resolveStorageKeys(db, projectId, stringList(data.referenceVideoAssetIds)),
          ];
          const referenceAudioR2Keys = [
            ...stringList(data.referenceAudioR2Keys),
            ...resolveStorageKeys(db, projectId, stringList(data.referenceAudioAssetIds)),
          ];
          const refs: Record<string, string[]> = {};
          if (referenceImageR2Keys.length) refs.image = referenceImageR2Keys;
          if (referenceVideoR2Keys.length) refs.video = referenceVideoR2Keys;
          if (referenceAudioR2Keys.length) refs.audio = referenceAudioR2Keys;

          const taskId = `local-custom-${sanitizeStorageSegment(nodeId)}`;
          if (tasks.get(taskId)) continue;
          const taskRecord: Record<string, unknown> = {
            taskId,
            nodeId,
            projectId,
            actionType: data.actionType,
            customActionId: custom.actionId,
            params: data.customActionParams && typeof data.customActionParams === "object"
              ? data.customActionParams
              : {},
            prompt: typeof data.prompt === "string"
              ? data.prompt
              : typeof data.content === "string"
                ? data.content
                : "",
            outputType: custom.outputType,
            refs,
            referenceImageR2Keys,
            referenceVideoR2Keys,
            referenceAudioR2Keys,
            actorType: data.actorType === "agent" ? "agent" : "user",
            actorUserId: typeof data.actorUserId === "string" ? data.actorUserId : userId,
            actorAgentId: typeof data.actorAgentId === "string" ? data.actorAgentId : undefined,
            status: "waiting_for_agent",
            createdAt: Date.now(),
            registeredByRuntime: typeof actionDef.registeredByRuntime === "string" ? actionDef.registeredByRuntime : undefined,
          };
          tasks.set(taskId, taskRecord);
          nodes.set(nodeId, {
            ...node,
            data: {
              ...data,
              status: "generating",
              pendingTask: taskId,
              pendingTaskAt: Date.now(),
            },
          });
          changed = true;
          input.broadcastJson?.({ type: "custom_task_assigned", task: taskRecord });
          continue;
        }

        const kind = pendingKindForNode(node);
        if (!kind) continue;

        const taskId = `local-gen-${sanitizeStorageSegment(nodeId)}`;
        const data = node.data as Record<string, unknown>;
        try {
          const prompt = promptFromData(data, `Mock ${kind}`);
          const model = modelFromData(data, `mock-${kind}`);
          const common = { taskId, prompt, model };
          const generated = kind === "image"
            ? await aigc.generateImage({
                ...common,
                aspectRatio: aspectRatioFromData(data),
              })
            : kind === "video"
              ? await aigc.generateVideo({
                  ...common,
                  aspectRatio: aspectRatioFromData(data),
                  duration: durationFromData(data, 4),
                })
              : await aigc.generateAudio({
                  ...common,
                  duration: durationFromData(data, 5),
                });
          const asset = await saveAsset({
            dataDir: options.dataDir,
            userId,
            projectId,
            taskId,
            kind,
            nodeData: data,
            bytes: generated.bytes,
            contentType: generated.contentType,
            width: generated.width,
            height: generated.height,
            durationMs: generated.durationMs,
            waveform: generated.waveform,
            transcript: generated.transcript,
            requestId: generated.requestId,
            provider: generated.provider,
            modelEndpoint: generated.modelEndpoint,
            remoteUrl: generated.remoteUrl,
          });
          const nextData = {
            ...data,
            status: "completed",
            assetId: asset.id,
          };
          delete (nextData as Record<string, unknown>).pendingTask;
          delete (nextData as Record<string, unknown>).pendingTaskAt;
          delete (nextData as Record<string, unknown>).error;
          nodes.set(nodeId, { ...node, data: nextData });
          changed = true;
        } catch (error) {
          const nextData = {
            ...data,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
          delete (nextData as Record<string, unknown>).pendingTask;
          delete (nextData as Record<string, unknown>).pendingTaskAt;
          nodes.set(nodeId, { ...node, data: nextData });
          changed = true;
        }
      }

      return changed;
    },
  };
}
