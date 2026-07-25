import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { LoroDoc } from "loro-crdt";
import { hostMutationSucceeded } from "@clash/shared-types";
import type { TextAppliedRevision } from "@clash/shared-types";
import type { Asset, AssetKind } from "@clash/shared-types/assets";
import { createMockExternalAigcService, type ExternalAigcService } from "./local-aigc.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import { assetPathForWrite } from "./local-asset-paths.js";
import { storeTextRevisionContentBlob } from "./text-revision-content.js";

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
  mediaBaseUrl?: string;
  timelineRenderer?: LocalTimelineRenderer;
  aigc?: ExternalAigcService;
  textAgent?: {
    generate(input: {
      projectId: string;
      prompt: string;
      modelId?: string;
      modelParams?: Record<string, unknown>;
      actorAgentId?: string;
    }): Promise<{ text: string; provider?: string; modelEndpoint?: string }>;
  };
}

export interface LocalTimelineRenderer {
  render(input: {
    projectId: string;
    taskId: string;
    timelineDsl: Record<string, any>;
  }): Promise<{
    bytes: Uint8Array;
    contentType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  }>;
}

type ProcessableKind = Extract<AssetKind, "image" | "video" | "audio">;
type ProcessableNodeKind = ProcessableKind | "text";

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

function localAssetReferenceUrl(baseUrl: string, storageKey: string): string {
  const encodedKey = storageKey.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/assets/${encodedKey}`;
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

function textHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function textRevisionActor(
  nodeData: Record<string, unknown>,
  userId: string,
): TextAppliedRevision["actor"] | undefined {
  if (nodeData.actorType !== "user" && nodeData.actorType !== "agent") return undefined;
  return {
    actorType: nodeData.actorType,
    actorUserId: typeof nodeData.actorUserId === "string" && nodeData.actorUserId
      ? nodeData.actorUserId
      : userId,
    ...(typeof nodeData.actorAgentId === "string" && nodeData.actorAgentId
      ? { actorAgentId: nodeData.actorAgentId }
      : {}),
  };
}

function generatedTextRevision(options: {
  projectId: string;
  nodeId: string;
  content: string;
  nodeData: Record<string, unknown>;
  userId: string;
  createdAt?: string;
}): TextAppliedRevision {
  const contentHash = textHash(options.content);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const actor = textRevisionActor(options.nodeData, options.userId);
  const textId = `text:${options.projectId}:${options.nodeId}`;
  const sourceFilePath = `workflow/${sanitizeStorageSegment(options.nodeId)}.md`;
  const seed = JSON.stringify({
    textId,
    contentHash,
    createdAt,
    actor: actor ?? null,
  });
  const suffix = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return {
    schemaVersion: 1,
    kind: "clash.text.revision",
    textId,
    revisionId: `txrev-${contentHash}-${suffix}`,
    projectId: options.projectId,
    nodeId: options.nodeId,
    createdAt,
    contentHash,
    hashAlgorithm: "sha256-64",
    sourceFilePath,
    sourceFileHash: contentHash,
    ...(actor ? { actor } : {}),
  };
}

async function recordGeneratedTextRevision(options: {
  dataDir: string;
  userId: string;
  projectId: string;
  nodeId: string;
  nodeData: Record<string, unknown>;
  content: string;
}): Promise<TextAppliedRevision> {
  const revision = generatedTextRevision(options);
  const mutation = hostMutationSucceeded({
    operation: "text_generate",
    entity: { kind: "text-revision", id: revision.revisionId },
  }, { resultEntityId: revision.revisionId });
  await storeTextRevisionContentBlob(options.dataDir, revision, options.content);
  await createLocalMetadataStore(options.dataDir).upsertTextRevision(revision, {
    id: randomUUID(),
    createdAt: Date.now(),
    operation: mutation.operation,
    entity: mutation.entity,
    actorClientType: options.nodeData.actorType === "agent" ? "agent" : null,
    accepted: mutation.accepted,
    reason: "workflow generated text",
    resultEntityId: mutation.resultEntityId ?? null,
    error: mutation.error ?? null,
    mutation,
  });
  return revision;
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

function pendingKindForNode(node: Record<string, any>): ProcessableNodeKind | null {
  if (node.type !== "image" && node.type !== "video" && node.type !== "audio" && node.type !== "text") return null;
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  if (data.assetId) return null;
  if (data.status !== "pending" && data.status !== "generating") return null;

  const kind = node.type as ProcessableNodeKind;
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
  const assetPath = await assetPathForWrite(options.dataDir, storageKey);
  await writeFile(assetPath, options.bytes);

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

  const mutation = hostMutationSucceeded({
    operation: "asset_generate",
    entity: { kind: "asset", id: asset.id },
  }, { resultEntityId: asset.id });
  await createLocalMetadataStore(options.dataDir).upsertAsset(asset, {
    assetId: asset.id,
    projectId: options.projectId,
    importedAt: now,
  }, {
    id: randomUUID(),
    createdAt: Date.now(),
    operation: mutation.operation,
    entity: mutation.entity,
    actorClientType: options.nodeData.actorType === "agent" ? "agent" : null,
    accepted: mutation.accepted,
    reason: "workflow generated asset",
    resultEntityId: mutation.resultEntityId ?? null,
    error: mutation.error ?? null,
    mutation,
  });
  return asset;
}

function localAssetHttpUrl(mediaBaseUrl: string, storageKey: string): string {
  const encodedKey = storageKey.split("/").map(encodeURIComponent).join("/");
  return `${mediaBaseUrl.replace(/\/+$/, "")}/assets/${encodedKey}`;
}

async function resolveLocalTimelineDslReferences(options: {
  dataDir: string;
  doc: LoroDoc;
  projectId: string;
  mediaBaseUrl?: string;
  timelineDsl: Record<string, any>;
}): Promise<Record<string, any>> {
  const resolved = structuredClone(options.timelineDsl);
  const metadata = await createLocalMetadataStore(options.dataDir).load();
  const projectAssetIds = new Set(
    metadata.assetRefs
      .filter((ref) => ref.projectId === options.projectId)
      .map((ref) => ref.assetId),
  );
  const assetById = new Map(
    metadata.assets
      .filter((asset) => asset.projectId === options.projectId || projectAssetIds.has(asset.id))
      .map((asset) => [asset.id, asset]),
  );
  const nodes = options.doc.getMap("nodes");

  for (const track of resolved.tracks ?? []) {
    for (const item of track.items ?? []) {
      if (item.type !== "video" && item.type !== "image" && item.type !== "audio") continue;
      const lookupIds = [item.assetId, item.sourceNodeId]
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      if (typeof item.sourceNodeId === "string" && item.sourceNodeId.startsWith("timeline-asset:")) {
        lookupIds.push(item.sourceNodeId.slice("timeline-asset:".length));
      }
      let asset = lookupIds.map((id) => assetById.get(id)).find(Boolean);
      if (!asset) {
        for (const id of lookupIds) {
          const node = nodes.get(id) as Record<string, any> | undefined;
          const backingAssetId = typeof node?.data?.assetId === "string" ? node.data.assetId : undefined;
          if (backingAssetId && assetById.has(backingAssetId)) {
            asset = assetById.get(backingAssetId);
            break;
          }
        }
      }
      if (!asset) {
        throw new Error(`Timeline render cannot resolve media item ${String(item.id ?? "unknown")}`);
      }
      const signedUrl = typeof asset.signedUrl === "string" ? asset.signedUrl : "";
      // Local signed URLs are host-instance projections and may contain a
      // port from an earlier desktop launch. Rebind storage identity to the
      // currently listening local API whenever its origin is available.
      item.src = options.mediaBaseUrl
        ? localAssetHttpUrl(options.mediaBaseUrl, asset.srcR2Key)
        : signedUrl;
      if (!item.src) {
        throw new Error("Timeline rendering requires a local media base URL");
      }
    }
  }
  return resolved;
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

          const metadataStore = createLocalMetadataStore(options.dataDir);
          const [referenceImageR2Keys, referenceVideoR2Keys, referenceAudioR2Keys] = await Promise.all([
            metadataStore.resolveStorageKeys(projectId, stringList(data.referenceImageAssetIds)),
            metadataStore.resolveStorageKeys(projectId, stringList(data.referenceVideoAssetIds)),
            metadataStore.resolveStorageKeys(projectId, stringList(data.referenceAudioAssetIds)),
          ]);
          referenceImageR2Keys.unshift(...stringList(data.referenceImageR2Keys));
          referenceVideoR2Keys.unshift(...stringList(data.referenceVideoR2Keys));
          referenceAudioR2Keys.unshift(...stringList(data.referenceAudioR2Keys));
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

        const renderData = node.data && typeof node.data === "object"
          ? node.data as Record<string, any>
          : {};
        const isTimelineRender = node.type === "video" &&
          renderData.status === "pending" &&
          !renderData.assetId &&
          !renderData.pendingTask &&
          renderData.timelineDsl &&
          typeof renderData.timelineDsl === "object";
        if (isTimelineRender) {
          const taskId = `local-render-${sanitizeStorageSegment(nodeId)}`;
          try {
            if (!options.timelineRenderer) {
              throw new Error("Timeline rendering backend is unavailable");
            }
            const timelineDsl = await resolveLocalTimelineDslReferences({
              dataDir: options.dataDir,
              doc,
              projectId,
              mediaBaseUrl: options.mediaBaseUrl,
              timelineDsl: renderData.timelineDsl,
            });
            const rendered = await options.timelineRenderer.render({
              projectId,
              taskId,
              timelineDsl,
            });
            const asset = await saveAsset({
              dataDir: options.dataDir,
              userId,
              projectId,
              taskId,
              kind: "video",
              nodeData: {
                ...renderData,
                modelId: "remotion-render",
                prompt: `Render Timeline ${String(renderData.sourceTimelineId ?? nodeId)}`,
              },
              bytes: rendered.bytes,
              contentType: rendered.contentType ?? "video/mp4",
              width: rendered.width,
              height: rendered.height,
              durationMs: rendered.durationMs,
              provider: "local-render",
            });
            const nextData: Record<string, any> = {
              ...renderData,
              status: "completed",
              assetId: asset.id,
            };
            delete nextData.pendingTask;
            delete nextData.pendingTaskAt;
            delete nextData.error;
            nodes.set(nodeId, { ...node, data: nextData });
          } catch (error) {
            const nextData: Record<string, any> = {
              ...renderData,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            };
            delete nextData.pendingTask;
            delete nextData.pendingTaskAt;
            nodes.set(nodeId, { ...node, data: nextData });
          }
          changed = true;
          continue;
        }

        const kind = pendingKindForNode(node);
        if (!kind) continue;

        const taskId = `local-gen-${sanitizeStorageSegment(nodeId)}`;
        const data = node.data as Record<string, unknown>;
        try {
          const prompt = promptFromData(data, `Mock ${kind}`);
          const model = modelFromData(data, `mock-${kind}`);
          const directReferenceUrls = stringList(data.referenceImageUrls);
          const referenceImageKeys = kind === "image"
            ? [
                ...stringList(data.referenceImageR2Keys),
                ...await createLocalMetadataStore(options.dataDir)
                  .resolveStorageKeys(projectId, stringList(data.referenceImageAssetIds)),
              ]
            : [];
          const referenceImageUrls = [
            ...directReferenceUrls,
            ...(options.mediaBaseUrl
              ? referenceImageKeys.map((key) => localAssetReferenceUrl(options.mediaBaseUrl!, key))
              : []),
          ];
          const common = {
            taskId,
            prompt,
            model,
            modelParams: modelParams(data),
            ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
          };
          if (kind === "text") {
            let generated;
            try {
              generated = options.textAgent && model === "local-acp"
                ? await options.textAgent.generate({
                    projectId,
                    prompt,
                    modelId: model,
                    modelParams: modelParams(data),
                    actorAgentId: typeof data.actorAgentId === "string" ? data.actorAgentId : undefined,
                  })
                : await aigc.generateText(common);
            } catch {
              generated = await aigc.generateText(common);
            }
            await recordGeneratedTextRevision({
              dataDir: options.dataDir,
              userId,
              projectId,
              nodeId,
              nodeData: data,
              content: generated.text,
            });
            const nextData = {
              ...data,
              status: "completed",
              content: generated.text,
              ...(generated.provider ? { provider: generated.provider } : {}),
              ...(generated.modelEndpoint ? { modelEndpoint: generated.modelEndpoint } : {}),
            };
            delete (nextData as Record<string, unknown>).pendingTask;
            delete (nextData as Record<string, unknown>).pendingTaskAt;
            delete (nextData as Record<string, unknown>).error;
            nodes.set(nodeId, { ...node, data: nextData });
            changed = true;
            continue;
          }

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
