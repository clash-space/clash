/**
 * Node Processor - Task Submission Only
 *
 * All tasks use the same pattern:
 * 1. NodeProcessor spots a node needing work
 * 2. Submit to /api/tasks/submit (writes to DB, starts background processing)
 * 3. Store task_id in node's pendingTask field
 * 4. TaskPolling will poll DB and update Loro Doc when complete
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../types';
import { updateNodeData } from '../sync/NodeUpdater';
import { MODEL_CARDS } from '@clash/shared-types';

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image')?.id ?? 'nano-banana-2';
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video')?.id ?? 'sora-2-image-to-video';
const defaultAudioModel = MODEL_CARDS.find((card) => card.kind === 'audio')?.id ?? 'minimax-tts';

const getModelCard = (modelId?: string) => MODEL_CARDS.find((card) => card.id === modelId);

type AssetStatus = 'uploading' | 'generating' | 'completed' | 'fin' | 'failed';
type NodeType = 'image' | 'video' | 'audio' | 'video_render';

/**
 * CRITICAL FIX: Removed in-memory processingNodes Set
 *
 * Previous implementation used a memory-based Set to prevent duplicate submissions.
 * This was unreliable because:
 * 1. Durable Object restarts would clear the Set
 * 2. Lock was released immediately after submission, before pendingTask sync
 * 3. Race conditions could still cause duplicate submissions
 *
 * NEW APPROACH: Use pendingTask field as persistent lock
 * - pendingTask is stored in Loro CRDT (persistent across restarts)
 * - Check pendingTask BEFORE submission (line 55)
 * - Set pendingTask IMMEDIATELY after successful submission
 * - This creates an atomic check-and-set pattern
 */

/**
 * Resolve assetId references in timeline DSL items.
 * This populates src/type/naturalWidth/naturalHeight from the referenced asset nodes.
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
        // Normalize src for matching (strip URL prefix to get R2 key)
        let srcKey = item.src;
        // Handle full URLs like "http://localhost:3000/api/assets/view/projects/..."
        const viewMatch = srcKey.match(/\/api\/assets\/view\/(.+)$/);
        if (viewMatch) {
          srcKey = viewMatch[1]; // Extract R2 key
        }

        // Try exact match first
        assetNode = srcToNode.get(item.src) || srcToNode.get(srcKey);

        // Try partial match (R2 key might be stored differently)
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
        // Extract asset data - handle both direct objects and Loro proxies
        let assetData: Record<string, any> = {};
        const rawData = assetNode.data || assetNode;

        if (typeof rawData?.toJSON === 'function') {
          assetData = rawData.toJSON();
        } else if (rawData) {
          assetData = typeof rawData === 'object' ? { ...rawData } : {};
        }

        // Get type from node or data
        const assetType = assetNode.type || assetData.type;

        // Resolve dimensions
        let naturalWidth = assetData.naturalWidth;
        let naturalHeight = assetData.naturalHeight;

        // Fallback: parse aspectRatio string (e.g., "16:9") if no natural dimensions
        if ((!naturalWidth || !naturalHeight) && assetData.aspectRatio) {
          const ar = assetData.aspectRatio;
          if (typeof ar === 'string' && ar.includes(':')) {
            const [w, h] = ar.split(':').map(Number);
            if (w && h) {
              // Use 1920 as base width (matches frontend logic)
              naturalWidth = 1920;
              naturalHeight = Math.round(1920 * h / w);
            }
          }
        }

        const matchMethod = item.assetId ? `assetId=${item.assetId.slice(0, 8)}` : `src-match`;
        console.log(`[NodeProcessor] Resolved ${matchMethod} -> type=${assetType}, src=${assetData.src?.slice(0, 30) || 'none'}, dim=${naturalWidth}x${naturalHeight}`);

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
 * Process pending nodes - submit tasks to API/DB
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

      const status = innerData.status as AssetStatus;
      const src = innerData.src;
      const description = innerData.description;
      const pendingTask = innerData.pendingTask;

      // Skip if already has a pending task or is submitting
      if (pendingTask || innerData.taskState === 'submitted' || innerData.taskState === 'completed') continue;

      // Case 1: generating + no src -> submit generation task
      // OR video_render + status generating -> submit render task
      // OR video node with timelineDsl + status generating -> submit render task
      const hasTimelineDsl = innerData.timelineDsl != null;
      const shouldRenderVideo = nodeType === 'video_render' || (nodeType === 'video' && hasTimelineDsl);

      // Video render is handled client-side via Remotion — skip entirely
      if (shouldRenderVideo && status === 'generating') {
        continue;
      }

      if (status === 'generating' && !src) {
        // CRITICAL: Set taskState to 'submitted' IMMEDIATELY to prevent duplicate submissions
        updateNodeData(doc, nodeId, { taskState: 'submitted' }, broadcast);
        console.log(`[NodeProcessor] 🔒 Set taskState=submitted for node ${nodeId.slice(0, 8)}`);

        // Original AIGC generation logic
        console.log(`[NodeProcessor] 🚀 Submitting ${nodeType}_gen for ${nodeId.slice(0, 8)}`);

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

        // Extract aspect ratio from modelParams or node data (fallback to 16:9)
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
          // Audio/TTS generation - no reference images or aspect ratio needed
          // Text comes from prompt field
        } else {
          // Image generation
          params.aspect_ratio = aspectRatio;
        }

        const result = await submitTask(env, taskType, projectId, nodeId, params);

        if (result.task_id) {
          console.log(`[NodeProcessor] ✅ Task submitted successfully: ${result.task_id} for node ${nodeId.slice(0, 8)}`);
          updateNodeData(doc, nodeId, { taskState: 'completed', pendingTask: result.task_id }, broadcast);
          submitted = true;
        } else {
          console.error(`[NodeProcessor] ❌ Task submission failed for node ${nodeId.slice(0, 8)}: ${result.error}`);
          // Reset taskState so it can be retried
          updateNodeData(doc, nodeId, { taskState: 'pending', status: 'failed', error: result.error || 'Task submission failed' }, broadcast);
        }
      }

      // Case 2: completed + has src + no description -> submit description task
      // Skip audio nodes - they don't need descriptions
      if (status === 'completed' && src && !description && nodeType !== 'audio' && !pendingTask && innerData.taskState !== 'submitted') {
        updateNodeData(doc, nodeId, { taskState: 'submitted' }, broadcast);
        console.log(`[NodeProcessor] 🔒 Set taskState=submitted for description: ${nodeId.slice(0, 8)}`);

        console.log(`[NodeProcessor] 📝 Submitting description for ${nodeId.slice(0, 8)}`);

        const taskType = nodeType === 'image' ? 'image_desc' : 'video_desc';
        const params = {
          r2_key: src,
          mime_type: nodeType === 'image' ? 'image/png' : 'video/mp4',
        };

        const result = await submitTask(env, taskType, projectId, nodeId, params);

        if (result.task_id) {
          updateNodeData(doc, nodeId, { taskState: 'completed', pendingTask: result.task_id }, broadcast);
          submitted = true;
        } else {
          updateNodeData(doc, nodeId, { taskState: 'pending', status: 'fin' }, broadcast);
        }
      }

      // Note: Video cover images are now captured during video generation from Kling API.
      // No separate thumbnail extraction step needed.
    }

    if (submitted) {
      await triggerPolling();
    }
  } catch (error) {
    console.error('[NodeProcessor] ❌ Error:', error);
  }
}

/**
 * Submit task to api-cf (via Service Binding or fallback URL)
 */
async function submitTask(
  env: Env,
  taskType: string,
  projectId: string,
  nodeId: string,
  params: Record<string, any>
): Promise<{ task_id?: string; error?: string }> {
  try {
    const payload = JSON.stringify({
      task_type: taskType,
      project_id: projectId,
      node_id: nodeId,
      params: params,
    });

    const opts: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    };

    console.log(`[NodeProcessor] 📤 Submitting task: type=${taskType}, project=${projectId}, node=${nodeId.slice(0, 8)}`);

    const response = env.API_CF
      ? await env.API_CF.fetch("https://api-cf/api/tasks/submit", opts)
      : await fetch(`${env.BACKEND_API_URL}/api/tasks/submit`, opts);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[NodeProcessor] ❌ HTTP ${response.status} error submitting task: ${text}`);
      return { error: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json() as { task_id?: string };
    return { task_id: result.task_id };
  } catch (e) {
    console.error(`[NodeProcessor] ❌ Exception during task submission:`, e);
    return { error: String(e) };
  }
}
