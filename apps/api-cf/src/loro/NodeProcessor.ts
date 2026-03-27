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

import { MODEL_CARDS } from '@clash/shared-types';

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image')?.id ?? 'nano-banana-2';
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video')?.id ?? 'sora-2-image-to-video';
const defaultAudioModel = MODEL_CARDS.find((card) => card.kind === 'audio')?.id ?? 'minimax-tts';

const getModelCard = (modelId?: string) => MODEL_CARDS.find((card) => card.id === modelId);

type NodeType = 'image' | 'video' | 'audio' | 'video_render';

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

/**
 * Resolve assetId references in timeline DSL items.
 * Populates src/type/naturalWidth/naturalHeight from the referenced asset nodes.
 *
 * Timeline items use a reference-based model where they only store assetId.
 * The backend render service doesn't have access to Loro, so we must resolve
 * these references before submitting the render task.
 */
function resolveTimelineDslReferences(
  timelineDsl: Record<string, any>,
  nodesMap: Map<string, any>
): Record<string, any> {
  // Build a src -> node lookup for matching by src (for items without assetId)
  const srcToNode = new Map<string, any>();
  for (const [nodeId, nodeData] of nodesMap.entries()) {
    const data = nodeData?.data || nodeData;
    // Handle Loro proxy objects
    const src = typeof data?.toJSON === 'function' ? data.toJSON()?.src : data?.src;
    if (src) {
      srcToNode.set(src, { nodeId, ...nodeData });
    }
  }

  const resolvedTracks = (timelineDsl.tracks || []).map((track: any) => {
    const resolvedItems = (track.items || []).map((item: any) => {
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
        let assetData: Record<string, any> = {};
        const rawData = assetNode.data || assetNode;

        if (typeof rawData?.toJSON === 'function') {
          assetData = rawData.toJSON();
        } else if (rawData) {
          assetData = typeof rawData === 'object' ? { ...rawData } : {};
        }

        const assetType = assetNode.type || assetData.type;

        let naturalWidth = assetData.naturalWidth;
        let naturalHeight = assetData.naturalHeight;

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
          src: assetData.src || item.src,
          type: assetType || item.type,
          ...(naturalWidth && { naturalWidth }),
          ...(naturalHeight && { naturalHeight }),
          ...(assetData.aspectRatio && { aspectRatio: assetData.aspectRatio }),
        };
      } else {
        log.warn(`No asset found for item id=${item.id}, src=${item.src?.slice(0, 50) || 'none'}`);
      }

      return item;
    });

    return { ...track, items: resolvedItems };
  });

  return { ...timelineDsl, tracks: resolvedTracks };
}

/**
 * Process pending nodes — submit tasks via Workflow.
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

      if (!['image', 'video', 'audio', 'video_render'].includes(nodeType)) continue;

      const status = innerData.status as string;
      const src = innerData.src;
      const description = innerData.description;
      const pendingTask = innerData.pendingTask;

      // pendingTask is the optimistic lock — skip if already set
      if (pendingTask) continue;

      const hasTimelineDsl = innerData.timelineDsl != null;
      const shouldRenderVideo = nodeType === 'video_render' || (nodeType === 'video' && hasTimelineDsl);

      // Video render is handled client-side via Remotion — skip entirely
      if (shouldRenderVideo && status === Status.Pending) {
        continue;
      }

      // Case 1: pending + no src -> submit generation task
      if (status === Status.Pending && !src) {
        const taskId = crypto.randomUUID();
        const taskType = nodeType === 'image' ? 'image_gen' : nodeType === 'video' ? 'video_gen' : 'audio_gen';
        const tag = { nodeId, taskId, nodeType };

        // Set status=generating + pendingTask synchronously (optimistic lock) before any await
        updateNodeData(doc, nodeId, { status: Status.Generating, pendingTask: taskId }, broadcast);
        appendNodeLog(doc, nodeId, `task=${taskId.slice(0, 8)} type=${taskType} model=${(innerData.modelId || innerData.model) ?? 'default'}`, broadcast);

        const selectedModelId = (innerData.modelId || innerData.model) ??
          (nodeType === 'video' ? defaultVideoModel : nodeType === 'audio' ? defaultAudioModel : defaultImageModel);
        const modelParams = (innerData.modelParams || {}) as Record<string, any>;
        const referenceImages: string[] = Array.isArray(innerData.referenceImageUrls) ? innerData.referenceImageUrls : [];
        const modelCard = getModelCard(selectedModelId);
        const referenceMode = modelCard?.input.referenceMode || 'single';

        if (nodeType === 'video' && modelCard?.input.referenceImage === 'required') {
          const requiredCount = referenceMode === 'start_end' ? 2 : 1;
          if (referenceImages.length < requiredCount) {
            const msg = referenceMode === 'start_end'
              ? 'Two reference images (start/end) required for selected model'
              : 'Reference image required for selected model';
            updateNodeData(doc, nodeId, { pendingTask: undefined, status: Status.Failed, error: msg }, broadcast);
            continue;
          }
        }

        const result = await submitGenTask(env, taskType as GenerationParams['type'], projectId, nodeId, taskId, {
          prompt: innerData.prompt || innerData.label || '',
          model: selectedModelId,
          modelParams,
          referenceImages,
          referenceMode,
          aspectRatio: modelParams.aspect_ratio || innerData.aspectRatio || '16:9',
          duration: modelParams.duration ?? innerData.duration ?? 5,
          negativPrompt: modelParams.negative_prompt,
          cfgScale: modelParams.cfg_scale,
          resolution: modelParams.resolution,
          tailImageUrl: (referenceMode === 'start_end' && referenceImages[1]) ? referenceImages[1] : undefined,
          imageR2Key: referenceImages[0],
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
        updateNodeData(doc, nodeId, { pendingTask: taskId }, broadcast);
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
    model: string;
    modelParams: Record<string, any>;
    referenceImages: string[];
    referenceMode: string;
    aspectRatio: string;
    duration: number;
    negativPrompt?: string;
    cfgScale?: number;
    resolution?: string;
    tailImageUrl?: string;
    imageR2Key?: string;
  },
): Promise<{ error?: string }> {
  try {
    // Resolve reference images to base64 before workflow submission
    const resolvedImages: string[] = [];
    for (const ref of params.referenceImages) {
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        try {
          const resp = await fetch(ref);
          if (resp.ok) resolvedImages.push(arrayBufferToBase64(await resp.arrayBuffer()));
        } catch (e) {
          log.error(`Failed to fetch reference image: ${ref}`, e);
        }
      } else if (ref.startsWith('projects/')) {
        try {
          const obj = await env.R2_BUCKET.get(ref);
          if (obj) resolvedImages.push(arrayBufferToBase64(await obj.arrayBuffer()));
        } catch (e) {
          log.error(`Failed to fetch R2 image: ${ref}`, e);
        }
      }
    }

    // Resolve video source image
    let imageBase64: string | undefined;
    if (taskType === 'video_gen' && params.imageR2Key) {
      const imageRef = params.imageR2Key;
      if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
        const resp = await fetch(imageRef);
        if (resp.ok) imageBase64 = arrayBufferToBase64(await resp.arrayBuffer());
      } else if (imageRef.startsWith('projects/')) {
        const obj = await env.R2_BUCKET.get(imageRef);
        if (obj) imageBase64 = arrayBufferToBase64(await obj.arrayBuffer());
      }
    }

    // Submit to Workflow
    const genParams: GenerationParams = {
      taskId,
      nodeId,
      type: taskType,
      projectId,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      modelName: params.model,
      modelParams: params.modelParams as Record<string, unknown>,
      base64Images: resolvedImages.length ? resolvedImages : undefined,
      imageBase64,
      duration: params.duration,
      cfgScale: params.cfgScale,
      videoModel: params.model,
    };

    await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
    return {};
  } catch (e) {
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
