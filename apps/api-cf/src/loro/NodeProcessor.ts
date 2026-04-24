/**
 * Node Processor - Task Submission via Cloudflare Workflows
 *
 * Scans Loro nodes for pending work and submits generation/description
 * tasks as Workflow instances. Uses `pendingTask` field as an optimistic
 * lock — set synchronously before any async work.
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../config';
import { log } from '../logger';
import { updateNodeData, appendNodeLog } from './NodeUpdater';
import { Status } from '../domain/canvas';
import type { GenerationParams } from '../agents/generation';
import { getAssetById } from '../services/assets';
import { signAssetPath } from '../services/asset-signing';

import { MODEL_CARDS, parsePromptParts, extractPromptText } from '@clash/shared-types';

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image')?.id ?? 'nano-banana-2';
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video')?.id ?? 'sora-2';
const defaultAudioModel = MODEL_CARDS.find((card) => card.kind === 'audio')?.id ?? 'gemini-3.1-flash-tts';
const defaultTextModel = MODEL_CARDS.find((card) => card.kind === 'text')?.id ?? 'gpt-5.4';

const getModelCard = (modelId?: string) => MODEL_CARDS.find((card) => card.id === modelId);

type NodeType = 'image' | 'video' | 'audio' | 'text' | 'video_render';

// Fallback upper-bound wall time per node kind. Used when the selected model card
// doesn't specify its own `maxRuntimeMs`. Set generously above the 99th-percentile
// run so we never misclassify a legitimately slow task.
const DEFAULT_RUNNING_ORPHAN_MS: Record<string, number> = {
  image: 15 * 60 * 1000,
  video: 30 * 60 * 1000,
  audio: 10 * 60 * 1000,
  text: 5 * 60 * 1000,
  video_render: 30 * 60 * 1000,
};

function resolveMaxRuntimeMs(nodeType: string, modelId?: string): number {
  const card = getModelCard(modelId);
  return card?.maxRuntimeMs ?? DEFAULT_RUNNING_ORPHAN_MS[nodeType] ?? 30 * 60 * 1000;
}

/**
 * Pick which workflow binding owns a given taskId.
 * All our generation tasks currently use GENERATION_WORKFLOW.
 */
function getWorkflowBinding(env: Env): Workflow | undefined {
  return env.GENERATION_WORKFLOW as Workflow | undefined;
}

/**
 * Check the workflow engine's view of a task. Returns a terminal status if the
 * workflow is effectively dead (errored / terminated / instance missing), or null
 * if it's still legitimately in-flight or unknown.
 *
 * Needed because miniflare's workflow engine doesn't resume after worker hot-reload
 * (no alarm() method on Engine; scheduler.wait is in-memory only). Stuck workflows
 * sit in "running" forever locally — for us that's indistinguishable from normal
 * running, so we additionally trust "complete" / "errored" / "terminated".
 */
/** Hard timeout — miniflare wf.get/status can hang on certain instances and pin the DO loop. */
const WF_STATUS_TIMEOUT_MS = 1500;

async function inspectWorkflowStatus(
  env: Env,
  taskId: string
): Promise<{ status: string; error?: string } | null> {
  const wf = getWorkflowBinding(env);
  if (!wf) return null;

  const probe = (async () => {
    try {
      const inst = await wf.get(taskId);
      const s = await inst.status();
      return { status: String(s.status ?? ''), error: s.error ? String(s.error) : undefined };
    } catch (e) {
      const msg = String(e);
      if (/not\s*found|Error 3001|doesn't exist/i.test(msg)) return { status: 'missing' };
      log.warn('inspectWorkflowStatus error', { taskId, error: msg });
      return null;
    }
  })();

  const timeout = new Promise<{ status: string }>((resolve) =>
    setTimeout(() => resolve({ status: 'timeout' }), WF_STATUS_TIMEOUT_MS),
  );

  const result = await Promise.race([probe, timeout]);
  // 'timeout' is treated as 'unknown' upstream — caller should not act on it.
  if (result && (result as { status: string }).status === 'timeout') {
    log.warn('inspectWorkflowStatus timed out — treating as unknown', { taskId });
    return null;
  }
  return result;
}

/** Convert ArrayBuffer to base64, chunked to avoid stack overflow. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(''));
}

function toPlainRecord(value: unknown): Record<string, any> {
  if (typeof (value as { toJSON?: () => unknown } | null)?.toJSON === 'function') {
    const json = (value as { toJSON: () => unknown }).toJSON();
    return json && typeof json === 'object' ? { ...(json as Record<string, unknown>) } : {};
  }
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
}

function srcToStorageKey(src: string): string {
  if (!src) return src;

  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  const prefixes = ['/assets/', '/api/assets/view/', '/api/assets/'];
  const pathname = (() => {
    if (!src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://')) {
      return src;
    }
    try {
      const url = src.startsWith('http')
        ? new URL(src)
        : new URL(src, 'http://placeholder.local');
      return url.pathname;
    } catch {
      return src;
    }
  })();

  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      return pathname.slice(prefix.length);
    }
  }

  return pathname.startsWith('/') ? pathname.slice(1) : pathname;
}

/**
 * Resolve assetId references in timeline DSL items.
 * Populates src/type/naturalWidth/naturalHeight from the referenced asset nodes.
 *
 * Timeline items use a reference-based model where they only store assetId.
 * The backend render service doesn't have access to Loro, so we must resolve
 * these references before submitting the render task.
 */
async function resolveTimelineDslReferences(
  timelineDsl: Record<string, any>,
  nodesMap: Map<string, any>,
  env: Env,
): Promise<Record<string, any>> {
  // Build a src -> node lookup for matching by src (for items without assetId)
  const srcToNode = new Map<string, any>();
  for (const [nodeId, nodeData] of nodesMap.entries()) {
    const data = toPlainRecord(nodeData?.data || nodeData);
    const src = typeof data.src === 'string' ? data.src : undefined;
    if (src) {
      srcToNode.set(src, { nodeId, ...nodeData });
    }
  }

  const assetCache = new Map<string, Awaited<ReturnType<typeof getAssetById>>>();

  const resolvedTracks = await Promise.all((timelineDsl.tracks || []).map(async (track: any) => {
    const resolvedItems = await Promise.all((track.items || []).map(async (item: any) => {
      let assetNode: any = null;

      // 1. Try to find by assetId first
      if (item.assetId) {
        assetNode = nodesMap.get(item.assetId);
      }

      // 2. If no assetId or not found, try to match by src
      if (!assetNode && item.src) {
        let srcKey = item.src;
        const viewMatch = srcKey.match(/\/api\/assets\/view\/(.+)$/);
        if (viewMatch) {
          srcKey = viewMatch[1];
        }

        assetNode = srcToNode.get(item.src) || srcToNode.get(srcKey);

        if (!assetNode) {
          for (const [storedSrc, node] of srcToNode.entries()) {
            if (storedSrc.includes(srcKey) || srcKey.includes(storedSrc)) {
              assetNode = node;
              break;
            }
          }
        }
      }

      if (assetNode) {
        const assetData = toPlainRecord(assetNode.data || assetNode);
        const assetRowId = typeof assetData.assetId === 'string' ? assetData.assetId : undefined;
        let assetRow = null;

        if (assetRowId) {
          if (!assetCache.has(assetRowId)) {
            assetCache.set(assetRowId, await getAssetById(env.DB, assetRowId));
          }
          assetRow = assetCache.get(assetRowId) ?? null;
        }

        const assetType = assetNode.type || assetRow?.kind || assetData.type || item.type;

        let naturalWidth = assetRow?.metadata?.width ?? assetData.naturalWidth;
        let naturalHeight = assetRow?.metadata?.height ?? assetData.naturalHeight;

        if ((!naturalWidth || !naturalHeight) && assetData.aspectRatio) {
          const ar = assetData.aspectRatio;
          if (typeof ar === 'string' && ar.includes(':')) {
            const [w, h] = ar.split(':').map(Number);
            if (w && h) {
              naturalWidth = 1920;
              naturalHeight = Math.round(1920 * h / w);
            }
          }
        }

        return {
          ...item,
          src: assetRow?.srcR2Key || assetData.src || item.src,
          type: assetType || item.type,
          ...(naturalWidth != null && { naturalWidth }),
          ...(naturalHeight != null && { naturalHeight }),
          ...(assetData.aspectRatio && { aspectRatio: assetData.aspectRatio }),
        };
      } else {
        log.warn(`No asset found for item id=${item.id}, src=${item.src?.slice(0, 50) || 'none'}`);
      }

      return item;
    }));

    return { ...track, items: resolvedItems };
  }));

  return { ...timelineDsl, tracks: resolvedTracks };
}

/**
 * Recover orphaned tasks — scan nodes with `pendingTask` and mark Failed any
 * whose backing workflow is errored / terminated / missing, or whose runtime
 * has exceeded the per-kind cap (covers miniflare's lost-timer hibernation).
 *
 * SLOW PATH: each pending node triggers a workflow status RPC (timeboxed).
 * Caller must NOT run this from the WebSocket message-processing critical
 * section — it's reserved for the alarm timer to keep WS handling responsive.
 * Per-task probes run in parallel so total cost is max-of-N rather than sum.
 */
export async function recoverOrphanedTasks(
  doc: LoroDoc,
  env: Env,
  broadcast: (data: Uint8Array) => void,
): Promise<void> {
  const nodesMap = doc.getMap('nodes');
  const candidates: Array<{ nodeId: string; nodeType: NodeType; pendingTask: string; pendingTaskAt?: number; modelId?: string }> = [];

  for (const [nodeId, nodeData] of nodesMap.entries()) {
    const data = nodeData as Record<string, any>;
    const nodeType = data?.type as NodeType;
    if (!['image', 'video', 'audio', 'video_render'].includes(nodeType)) continue;
    const innerData = data?.data || {};
    const pendingTask = innerData.pendingTask as string | undefined;
    if (!pendingTask) continue;
    candidates.push({
      nodeId,
      nodeType,
      pendingTask,
      pendingTaskAt: typeof innerData.pendingTaskAt === 'number' ? innerData.pendingTaskAt : undefined,
      modelId: (innerData.modelId || innerData.model) as string | undefined,
    });
  }

  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.map(async ({ nodeId, nodeType, pendingTask, pendingTaskAt, modelId }) => {
      const info = await inspectWorkflowStatus(env, pendingTask);
      const age = pendingTaskAt ? Date.now() - pendingTaskAt : undefined;
      const runningTooLong = info?.status === 'running'
        && age !== undefined
        && age > resolveMaxRuntimeMs(nodeType, modelId);

      if (info && ['errored', 'terminated', 'missing'].includes(info.status)) {
        const reason = `orphan task: workflow status=${info.status}${info.error ? ` (${info.error})` : ''}`;
        log.warn('Orphan pendingTask (terminal status), marking node Failed', { nodeId, nodeType, taskId: pendingTask, status: info.status });
        appendNodeLog(doc, nodeId, `FAILED: ${reason}`, broadcast);
        updateNodeData(doc, nodeId, { pendingTask: undefined, pendingTaskAt: undefined, status: Status.Failed, error: reason }, broadcast);
      } else if (runningTooLong) {
        const ageSec = Math.round((age ?? 0) / 1000);
        const reason = `orphan task: workflow still "running" after ${ageSec}s (presumed dead — miniflare hot-reload kills in-memory timers)`;
        log.warn('Orphan pendingTask (running-too-long), marking node Failed', { nodeId, nodeType, taskId: pendingTask, ageSec });
        appendNodeLog(doc, nodeId, `FAILED: ${reason}`, broadcast);
        updateNodeData(doc, nodeId, { pendingTask: undefined, pendingTaskAt: undefined, status: Status.Failed, error: reason }, broadcast);
      }
    }),
  );
}

/**
 * Process pending nodes — submit tasks via Workflow.
 *
 * FAST PATH: only handles nodes WITHOUT pendingTask (new submissions).
 * Nodes already in flight are skipped here; their failures are caught by
 * `recoverOrphanedTasks` from the alarm timer. This separation keeps the
 * WebSocket message handler off the slow workflow.status() critical path.
 *
 * Uses `pendingTask` as optimistic lock: set synchronously before any
 * async work so concurrent invocations (via event loop interleaving) skip.
 */
export async function processPendingNodes(
  doc: LoroDoc,
  env: Env,
  projectId: string,
  broadcast: (data: Uint8Array) => void,
  triggerPolling: () => Promise<void>
): Promise<void> {
  try {
    const nodesMap = doc.getMap('nodes');
    let submitted = false;

    for (const [nodeId, nodeData] of nodesMap.entries()) {
      const data = nodeData as Record<string, any>;
      const nodeType = data?.type as NodeType;
      const innerData = data?.data || {};

      if (!['image', 'video', 'audio', 'text', 'video_render'].includes(nodeType)) continue;

      const status = innerData.status as string;
      const src = innerData.src;
      const description = innerData.description;
      const pendingTask = innerData.pendingTask;
      const pendingTaskAt = typeof innerData.pendingTaskAt === 'number' ? innerData.pendingTaskAt : undefined;

      // Optimistic lock — skip nodes already in flight. Orphan recovery is the
      // alarm's job (see recoverOrphanedTasks) so this hot path stays fast.
      if (pendingTask) continue;

      const hasTimelineDsl = innerData.timelineDsl != null;
      const shouldRenderVideo = nodeType === 'video_render' || (nodeType === 'video' && hasTimelineDsl);

      // Case 0: video_render with timelineDsl → submit render task
      if (shouldRenderVideo && status === Status.Pending) {
        const taskId = crypto.randomUUID();
        updateNodeData(doc, nodeId, { status: Status.Generating, pendingTask: taskId, pendingTaskAt: Date.now() }, broadcast);
        appendNodeLog(doc, nodeId, `task=${taskId.slice(0, 8)} type=video_render`, broadcast);

        // Resolve assetId references in timelineDsl using current Loro state
        const nodesMap = doc.getMap('nodes');
        const resolvedDsl = await resolveTimelineDslReferences(innerData.timelineDsl, nodesMap as any, env);

        // Convert R2 keys in src to signed absolute HTTP URLs so render-server's
        // Chromium/ffmpeg can access the source media via the asset-serving route.
        const mediaBase = (env.MEDIA_GATEWAY_URL || env.WORKER_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
        for (const track of resolvedDsl.tracks || []) {
          for (const item of track.items || []) {
            if (typeof item.src === 'string' && item.src && !item.src.startsWith('http') && !item.src.startsWith('data:') && !item.src.startsWith('blob:')) {
              const storageKey = srcToStorageKey(item.src);
              if (!storageKey || storageKey.startsWith('data:') || storageKey.startsWith('blob:')) {
                continue;
              }
              const signedPath = await signAssetPath(env, storageKey);
              item.src = `${mediaBase}${signedPath}`;
            }
          }
        }

        const genParams: GenerationParams = {
          taskId,
          nodeId,
          type: 'video_render',
          projectId,
          timelineDsl: resolvedDsl,
        };

        try {
          await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
          appendNodeLog(doc, nodeId, `submitted`, broadcast);
          submitted = true;
        } catch (e: any) {
          if (String(e).includes('already exists')) {
            appendNodeLog(doc, nodeId, `already running`, broadcast);
          } else {
            appendNodeLog(doc, nodeId, `FAILED: ${String(e)}`, broadcast);
            updateNodeData(doc, nodeId, { pendingTask: undefined, status: Status.Failed, error: String(e) }, broadcast);
          }
        }
        continue;
      }

      // Case: custom action pending → route based on runtime (local agent or CF Worker)
      if (status === Status.Pending && !src && innerData.actionType?.startsWith('custom:')) {
        const taskId = crypto.randomUUID();
        const actionId = innerData.customActionId ?? innerData.actionType.replace('custom:', '');
        updateNodeData(doc, nodeId, { status: Status.Generating, pendingTask: taskId, pendingTaskAt: Date.now() }, broadcast);
        appendNodeLog(doc, nodeId, `task=${taskId.slice(0, 8)} type=custom action=${actionId}`, broadcast);

        // Check runtime from Loro customActions map
        const actionsMap = doc.getMap('customActions');
        const actionDef = actionsMap.get(actionId) as Record<string, any> | undefined;
        const runtime = actionDef?.runtime || 'local';
        const workerUrl = actionDef?.workerUrl;

        if (runtime === 'worker' && workerUrl) {
          // Route to CF Worker via GenerationWorkflow (retries + durability)
          const genParams: GenerationParams = {
            taskId,
            nodeId,
            type: 'custom_action',
            projectId,
            prompt: innerData.prompt || innerData.content || '',
            customActionId: actionId,
            customActionParams: innerData.customActionParams || {},
            workerUrl,
          };

          try {
            await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
            appendNodeLog(doc, nodeId, `submitted to worker: ${workerUrl}`, broadcast);
            submitted = true;
          } catch (e: any) {
            appendNodeLog(doc, nodeId, `FAILED: ${String(e)}`, broadcast);
            updateNodeData(doc, nodeId, { pendingTask: undefined, status: Status.Failed, error: String(e) }, broadcast);
          }
        } else {
          // Route to local agent via Loro tasks map
          const versionBefore = doc.version();
          const tasksMap = doc.getMap('tasks');
          tasksMap.set(taskId, {
            taskId,
            nodeId,
            projectId,
            actionType: innerData.actionType,
            customActionId: actionId,
            params: innerData.customActionParams || {},
            prompt: innerData.prompt || innerData.content || '',
            outputType: innerData.outputType || 'image',
            status: 'waiting_for_agent',
            createdAt: Date.now(),
          });
          const update = doc.export({ mode: 'update', from: versionBefore });
          broadcast(update);
        }

        log.info('Custom action task dispatched', { nodeId, taskId, runtime, actionType: innerData.actionType });
        continue;
      }

      // Case 1: pending + no src -> submit generation task
      if (status === Status.Pending && !src) {
        // Deterministic taskId: same nodeId always maps to the same workflow ID,
        // so duplicate submissions (Loro race, alarm + queue, etc.) are idempotent.
        const taskId = `${projectId}-gen-${nodeId}`;
        const taskType =
          nodeType === 'image'
            ? 'image_gen'
            : nodeType === 'video'
              ? 'video_gen'
              : nodeType === 'audio'
                ? 'audio_gen'
                : 'text_gen';
        const tag = { nodeId, taskId, nodeType };

        // Set status=generating + pendingTask synchronously (optimistic lock) before any await
        updateNodeData(doc, nodeId, { status: Status.Generating, pendingTask: taskId, pendingTaskAt: Date.now() }, broadcast);
        appendNodeLog(doc, nodeId, `task=${taskId.slice(0, 8)} type=${taskType} model=${(innerData.modelId || innerData.model) ?? 'default'}`, broadcast);

        const selectedModelId = (innerData.modelId || innerData.model) ??
          (nodeType === 'video' ? defaultVideoModel : nodeType === 'audio' ? defaultAudioModel : nodeType === 'text' ? defaultTextModel : defaultImageModel);
        const modelParams = (innerData.modelParams || {}) as Record<string, any>;
        const referenceImages: string[] = Array.isArray(innerData.referenceImageUrls) ? innerData.referenceImageUrls : [];
        const referenceVideos: string[] = Array.isArray(innerData.referenceVideoUrls) ? innerData.referenceVideoUrls : [];
        const referenceAudios: string[] = Array.isArray(innerData.referenceAudioUrls) ? innerData.referenceAudioUrls : [];
        const modelCard = getModelCard(selectedModelId);
        const inputMode = modelCard?.input.inputMode ?? {};
        log.info('Gen task params', { nodeId, model: selectedModelId, images: referenceImages.length, videos: referenceVideos.length, audios: referenceAudios.length, prompt: innerData.prompt || innerData.label });

        // Pre-flight: refuse to submit the workflow when image refs violate the inputMode.
        // Only enforced for video gen (image gen is more forgiving).
        if (nodeType === 'video') {
          let msg: string | null = null;
          if (inputMode.startEnd && referenceImages.length < 1) {
            msg = 'Start frame required for selected model';
          } else if (inputMode.images) {
            const min = inputMode.images.min ?? 0;
            if (referenceImages.length < min) {
              msg = min === 1
                ? 'Reference image required for selected model'
                : `At least ${min} reference images required for selected model`;
            }
          }
          if (msg) {
            updateNodeData(doc, nodeId, { pendingTask: undefined, status: Status.Failed, error: msg }, broadcast);
            continue;
          }
        }

        // Parse prompt for @-mention parts (mixed-modality)
        const rawPrompt = innerData.prompt || innerData.label || '';
        const parts = parsePromptParts(rawPrompt);
        const cleanPrompt = extractPromptText(parts);

        // Resolve @-mentioned asset refs to R2 keys
        const resolvedParts = parts.map((part) => {
          if (part.type === 'asset_ref' && part.nodeId) {
            const refNode = nodesMap.get(part.nodeId) as Record<string, any> | undefined;
            const refSrc = refNode?.data?.src as string | undefined;
            return { type: 'asset_ref', nodeId: part.nodeId, r2Key: refSrc || undefined };
          }
          return { type: 'text', text: part.text || '' };
        });

        // Classify refs by role driven by the model's inputMode:
        //  - startEnd:                   refs[0] = first frame, refs[1] = tail frame
        //  - images.max === 1:           refs[0] = first frame  (legacy image-to-video)
        //  - images.max > 1:             refs = multi-reference images (no first frame)
        //  - otherwise (text-to-video):  no refs consumed
        // Routing refs to BOTH imageR2Key and referenceR2Keys makes Vertex Veo reject
        // the request with "image field is required for reference image".
        const imagesMax = inputMode.images?.max ?? 0;
        const isStartEnd = !!inputMode.startEnd;
        const isSingleFirstFrame = !isStartEnd && !!inputMode.images && imagesMax <= 1;
        const isMultiRef = !isStartEnd && !!inputMode.images && imagesMax > 1;
        const firstFrameKey = (isStartEnd || isSingleFirstFrame) ? referenceImages[0] : undefined;
        const tailFrameKey = isStartEnd ? referenceImages[1] : undefined;
        const multiRefImages = isMultiRef ? referenceImages : [];

        const result = await submitGenTask(env, taskType as GenerationParams['type'], projectId, nodeId, taskId, {
          prompt: cleanPrompt,
          promptParts: resolvedParts,
          model: selectedModelId,
          modelParams,
          referenceImages: multiRefImages,
          referenceVideos,
          referenceAudios,
          referenceMode: isStartEnd ? 'start_end' : isMultiRef ? 'multi' : isSingleFirstFrame ? 'single' : 'none',
          aspectRatio: modelParams.aspect_ratio || innerData.aspectRatio || '16:9',
          duration: modelParams.duration ?? innerData.duration ?? 5,
          negativPrompt: modelParams.negative_prompt,
          cfgScale: modelParams.cfg_scale,
          resolution: modelParams.resolution,
          tailImageR2Key: tailFrameKey,
          imageR2Key: firstFrameKey,
        });

        if (result.error) {
          appendNodeLog(doc, nodeId, `FAILED: ${result.error}`, broadcast);
          updateNodeData(doc, nodeId, { pendingTask: undefined, status: Status.Failed, error: result.error }, broadcast);
        } else {
          appendNodeLog(doc, nodeId, `submitted`, broadcast);
          submitted = true;
        }
      }

      // Case 2: completed + has src + no description -> submit description task
      if (status === Status.Completed && src && !description && nodeType !== 'audio' && !pendingTask) {
        const taskId = crypto.randomUUID();
        const tag = { nodeId, taskId, type: 'desc' };

        // Set pendingTask synchronously (optimistic lock) before any await
        updateNodeData(doc, nodeId, { pendingTask: taskId, pendingTaskAt: Date.now() }, broadcast);
        log.info("Submitting desc task", tag);

        const taskType: GenerationParams['type'] = nodeType === 'image' ? 'image_desc' : 'video_desc';

        // Normalise key — strip any accidental full-URL prefix
        const cleanKey = src.startsWith('http://') || src.startsWith('https://')
          ? new URL(src).pathname.replace(/^\//, '')
          : src;

        const result = await submitDescTask(env, taskType, projectId, nodeId, taskId, {
          r2Key: cleanKey,
          mimeType: nodeType === 'image' ? 'image/png' : 'video/mp4',
        });

        if (result.error) {
          // Description failure is non-critical — keep completed status
          updateNodeData(doc, nodeId, { pendingTask: undefined }, broadcast);
        } else {
          submitted = true;
        }
      }
    }

    if (submitted) {
      await triggerPolling();
    }
  } catch (error) {
    log.error('Error:', error);
  }
}

/**
 * Submit a generation task (image_gen/video_gen) via Workflow.
 */
async function submitGenTask(
  env: Env,
  taskType: GenerationParams['type'],
  projectId: string,
  nodeId: string,
  taskId: string,
  params: {
    prompt: string;
    promptParts?: Array<{ type: string; text?: string; nodeId?: string; r2Key?: string }>;
    model: string;
    modelParams: Record<string, any>;
    referenceImages: string[];
    referenceMode: string;
    aspectRatio: string;
    duration: number;
    negativPrompt?: string;
    cfgScale?: number;
    resolution?: string;
    tailImageR2Key?: string;
    imageR2Key?: string;
    referenceVideos?: string[];
    referenceAudios?: string[];
  },
): Promise<{ error?: string }> {
  try {
    const validR2 = (ref: string) =>
      ref.startsWith('projects/') || ref.startsWith('uploads/') || ref.startsWith('http://') || ref.startsWith('https://');
    const referenceR2Keys = params.referenceImages.filter(validR2);
    const referenceVideoR2Keys = (params.referenceVideos ?? []).filter(validR2);
    const referenceAudioR2Keys = (params.referenceAudios ?? []).filter(validR2);
    log.info('submitGenTask refs', { taskId, images: referenceR2Keys.length, videos: referenceVideoR2Keys.length, audios: referenceAudioR2Keys.length });

    const imageR2Key = taskType === 'video_gen' ? params.imageR2Key : undefined;

    const genParams: GenerationParams = {
      taskId,
      nodeId,
      type: taskType,
      projectId,
      prompt: params.prompt,
      promptParts: params.promptParts,
      aspectRatio: params.aspectRatio,
      modelName: params.model,
      modelParams: params.modelParams as Record<string, unknown>,
      referenceR2Keys: referenceR2Keys.length ? referenceR2Keys : undefined,
      referenceVideoR2Keys: referenceVideoR2Keys.length ? referenceVideoR2Keys : undefined,
      referenceAudioR2Keys: referenceAudioR2Keys.length ? referenceAudioR2Keys : undefined,
      imageR2Key,
      tailImageR2Key: params.tailImageR2Key,
      duration: params.duration,
      cfgScale: params.cfgScale,
      videoModel: params.model,
    };

    await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
    return {};
  } catch (e: any) {
    if (String(e).includes('already exists')) {
      log.info('Gen workflow already exists, skipping duplicate submission', { taskId, nodeId });
      return {};
    }
    log.error('Exception during task submission:', e);
    return { error: String(e) };
  }
}

/**
 * Submit a description task (image_desc/video_desc) via Workflow.
 */
async function submitDescTask(
  env: Env,
  taskType: GenerationParams['type'],
  projectId: string,
  nodeId: string,
  taskId: string,
  params: { r2Key: string; mimeType: string },
): Promise<{ error?: string }> {
  try {
    const genParams: GenerationParams = {
      taskId,
      nodeId,
      type: taskType,
      projectId,
      r2Key: params.r2Key,
      mimeType: params.mimeType,
    };

    await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
    return {};
  } catch (e) {
    log.error('Exception during desc submission:', e);
    return { error: String(e) };
  }
}
