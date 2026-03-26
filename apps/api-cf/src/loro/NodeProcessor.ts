/**
 * Node Processor - Task Submission
 *
 * Ported from loro-sync-server/src/processors/NodeProcessor.ts.
 * Key change: submitTask() now calls api-cf internal functions directly
 * instead of HTTP POST to /api/tasks/submit.
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../config';
import { updateNodeData } from './NodeUpdater';
import { createAsset, updateAssetStatus } from '../services/asset-store';
import { AssetStatus } from '../domain/canvas';
import type { GenerationParams } from '../agents/generation';

import { MODEL_CARDS } from '@clash/shared-types';

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image')?.id ?? 'nano-banana-2';
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video')?.id ?? 'sora-2-image-to-video';
const defaultAudioModel = MODEL_CARDS.find((card) => card.kind === 'audio')?.id ?? 'minimax-tts';

const getModelCard = (modelId?: string) => MODEL_CARDS.find((card) => card.id === modelId);

type AssetStatusType = 'uploading' | 'generating' | 'completed' | 'fin' | 'failed';
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
        console.warn(`[NodeProcessor] No asset found for item id=${item.id}, src=${item.src?.slice(0, 50) || 'none'}`);
      }

      return item;
    });

    return { ...track, items: resolvedItems };
  });

  return { ...timelineDsl, tracks: resolvedTracks };
}

/**
 * Process pending nodes - submit tasks directly via internal functions
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

      const status = innerData.status as AssetStatusType;
      const src = innerData.src;
      const description = innerData.description;
      const pendingTask = innerData.pendingTask;

      if (pendingTask || innerData.taskState === 'submitted' || innerData.taskState === 'completed') continue;

      const hasTimelineDsl = innerData.timelineDsl != null;
      const shouldRenderVideo = nodeType === 'video_render' || (nodeType === 'video' && hasTimelineDsl);

      // Video render is handled client-side via Remotion — skip entirely
      if (shouldRenderVideo && status === 'generating') {
        continue;
      }

      // Case 1: generating + no src -> submit generation task
      if (status === 'generating' && !src) {
        updateNodeData(doc, nodeId, { taskState: 'submitted' }, broadcast);

        const taskType = nodeType === 'image' ? 'image_gen' : nodeType === 'video' ? 'video_gen' : 'audio_gen';
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
            updateNodeData(doc, nodeId, { status: 'failed', error: msg }, broadcast);
            continue;
          }
        }

        const params: Record<string, any> = {
          prompt: innerData.prompt || innerData.label || '',
          model: selectedModelId,
          model_params: modelParams,
          reference_images: referenceImages,
          reference_mode: referenceMode,
        };

        const aspectRatio = modelParams.aspect_ratio || innerData.aspectRatio || '16:9';

        if (nodeType === 'video') {
          if (referenceImages[0]) {
            params.image_r2_key = referenceImages[0];
          }
          const duration = modelParams.duration ?? innerData.duration ?? 5;
          params.duration = duration;
          params.aspect_ratio = aspectRatio;
          if (modelParams.negative_prompt) params.negative_prompt = modelParams.negative_prompt;
          if (modelParams.cfg_scale) params.cfg_scale = modelParams.cfg_scale;
          if (modelParams.resolution) params.resolution = modelParams.resolution;
          if (referenceMode === 'start_end' && referenceImages[1]) {
            params.tail_image_url = referenceImages[1];
          }
        } else if (nodeType === 'audio') {
          // Audio/TTS - no extra params
        } else {
          params.aspect_ratio = aspectRatio;
        }

        const result = await submitTaskInternal(env, taskType, projectId, nodeId, params);

        if (result.task_id) {
          console.log(`[NodeProcessor] Task submitted: ${result.task_id} for node ${nodeId.slice(0, 8)}`);
          updateNodeData(doc, nodeId, { taskState: 'completed', pendingTask: result.task_id }, broadcast);
          submitted = true;
        } else {
          console.error(`[NodeProcessor] Task submission failed for node ${nodeId.slice(0, 8)}: ${result.error}`);
          updateNodeData(doc, nodeId, { taskState: 'pending', status: 'failed', error: result.error || 'Task submission failed' }, broadcast);
        }
      }

      // Case 2: completed + has src + no description -> submit description task
      if (status === 'completed' && src && !description && nodeType !== 'audio' && !pendingTask && innerData.taskState !== 'submitted') {
        updateNodeData(doc, nodeId, { taskState: 'submitted' }, broadcast);

        const taskType = nodeType === 'image' ? 'image_desc' : 'video_desc';
        const params = {
          r2_key: src,
          mime_type: nodeType === 'image' ? 'image/png' : 'video/mp4',
        };

        const result = await submitTaskInternal(env, taskType, projectId, nodeId, params);

        if (result.task_id) {
          updateNodeData(doc, nodeId, { taskState: 'completed', pendingTask: result.task_id }, broadcast);
          submitted = true;
        } else {
          updateNodeData(doc, nodeId, { taskState: 'pending', status: 'fin' }, broadcast);
        }
      }
    }

    if (submitted) {
      await triggerPolling();
    }
  } catch (error) {
    console.error('[NodeProcessor] Error:', error);
  }
}

/**
 * Submit task directly using api-cf internal functions (no HTTP round-trip).
 */
async function submitTaskInternal(
  env: Env,
  taskType: string,
  projectId: string,
  nodeId: string,
  params: Record<string, any>
): Promise<{ task_id?: string; error?: string }> {
  try {
    const taskId = crypto.randomUUID();
    console.log(`[NodeProcessor] Submitting task internally: type=${taskType}, project=${projectId}, node=${nodeId.slice(0, 8)}`);

    if (taskType === 'image_gen') {
      const referenceImages: string[] = params.reference_images ?? [];
      const resolvedImages: string[] = [];
      for (const ref of referenceImages) {
        if (ref.startsWith('http://') || ref.startsWith('https://')) {
          try {
            const resp = await fetch(ref);
            if (resp.ok) resolvedImages.push(arrayBufferToBase64(await resp.arrayBuffer()));
          } catch (e) {
            console.error(`[NodeProcessor] Failed to fetch reference image: ${ref}`, e);
          }
        } else if (ref.startsWith('projects/')) {
          try {
            const obj = await env.R2_BUCKET.get(ref);
            if (obj) resolvedImages.push(arrayBufferToBase64(await obj.arrayBuffer()));
          } catch (e) {
            console.error(`[NodeProcessor] Failed to fetch R2 image: ${ref}`, e);
          }
        }
      }

      await createAsset(env.DB, {
        id: nodeId,
        name: `image-${nodeId.slice(0, 8)}`,
        projectId,
        storageKey: `pending/${taskId}`,
        url: '',
        type: 'image',
        status: 'pending',
        taskId,
        metadata: JSON.stringify({ prompt: params.prompt, model: params.model }),
      });

      const genParams: GenerationParams = {
        taskId,
        type: 'image_gen',
        projectId,
        prompt: params.prompt ?? '',
        aspectRatio: params.aspect_ratio ?? '16:9',
        modelName: params.model,
        modelParams: params.model_params as Record<string, unknown> | undefined,
        base64Images: resolvedImages.length ? resolvedImages : undefined,
      };

      await delegateToGeneration(env, taskId, genParams);
      return { task_id: taskId };
    }

    if (taskType === 'video_gen') {
      let imageBase64: string | undefined;
      const imageRef = params.image_r2_key ?? params.reference_images?.[0];
      if (imageRef) {
        if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
          const resp = await fetch(imageRef);
          if (resp.ok) imageBase64 = arrayBufferToBase64(await resp.arrayBuffer());
        } else if (imageRef.startsWith('projects/')) {
          const obj = await env.R2_BUCKET.get(imageRef);
          if (obj) imageBase64 = arrayBufferToBase64(await obj.arrayBuffer());
        }
      }

      // Only require an image if the model card specifies it
      const videoModelCard = getModelCard(params.model);
      if (!imageBase64 && videoModelCard?.input.referenceImage === 'required') {
        return { error: 'No image provided for video generation' };
      }

      await createAsset(env.DB, {
        id: nodeId,
        name: `video-${nodeId.slice(0, 8)}`,
        projectId,
        storageKey: `pending/${taskId}`,
        url: '',
        type: 'video',
        status: 'pending',
        taskId,
        metadata: JSON.stringify({ prompt: params.prompt, duration: params.duration, model: params.model }),
      });

      const genParams: GenerationParams = {
        taskId,
        type: 'video_gen',
        projectId,
        prompt: params.prompt ?? '',
        imageBase64,
        duration: params.duration,
        aspectRatio: params.aspect_ratio,
        cfgScale: params.cfg_scale,
        videoModel: params.model,
      };

      await delegateToGeneration(env, taskId, genParams);
      return { task_id: taskId };
    }

    if (taskType === 'image_desc' || taskType === 'video_desc') {
      const r2Key = params.r2_key as string | undefined;
      if (!r2Key) return { error: 'Missing r2_key for description' };

      // Normalise key — strip any accidental full-URL prefix
      const cleanKey = r2Key.startsWith('http://') || r2Key.startsWith('https://')
        ? new URL(r2Key).pathname.replace(/^\//, '')
        : r2Key;

      await createAsset(env.DB, {
        id: `desc-${nodeId}`,
        name: `desc-${nodeId.slice(0, 8)}`,
        projectId,
        storageKey: cleanKey,
        url: cleanKey,
        type: taskType === 'image_desc' ? 'image' : 'video',
        status: 'processing',
        taskId,
      });

      // Fetch asset from R2 bucket and convert to base64 data URL so
      // generateDescription never needs a public URL.
      try {
        const { generateDescription } = await import('../services/describe');

        let dataUrl: string;
        const obj = await env.R2_BUCKET.get(cleanKey);
        if (obj) {
          const buf = await obj.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const mimeType = taskType === 'image_desc' ? (params.mime_type as string || 'image/png') : 'image/jpeg';
          dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
        } else {
          throw new Error(`R2 object not found: ${cleanKey}`);
        }

        const description = await generateDescription(env.CF_AIG_TOKEN, dataUrl);
        await updateAssetStatus(env.DB, taskId, {
          status: AssetStatus.Completed,
          description,
        });
      } catch (e) {
        console.error('[NodeProcessor] Description generation failed:', e);
        await updateAssetStatus(env.DB, taskId, {
          status: AssetStatus.Failed,
          metadata: JSON.stringify({ error: String(e) }),
        });
      }

      return { task_id: taskId };
    }

    if (taskType === 'audio_gen') {
      return { error: 'Audio generation is not yet supported' };
    }

    return { error: `Unknown task_type: ${taskType}` };
  } catch (e) {
    console.error('[NodeProcessor] Exception during internal task submission:', e);
    return { error: String(e) };
  }
}

/** Delegate a generation task to the GenerationAgent DO. */
async function delegateToGeneration(
  env: Env,
  taskId: string,
  genParams: GenerationParams
): Promise<void> {
  try {
    const doId = env.GENERATION.idFromName(taskId);
    const stub = env.GENERATION.get(doId);
    await stub.fetch(new Request('https://do/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-partykit-room': taskId,
        'x-partykit-namespace': 'GENERATION',
      },
      body: JSON.stringify(genParams),
    }));
  } catch (e) {
    console.error('Failed to delegate to GenerationAgent:', e);
    await updateAssetStatus(env.DB, taskId, {
      status: 'failed',
      metadata: JSON.stringify({ error: `DO delegation failed: ${String(e)}` }),
    });
  }
}
