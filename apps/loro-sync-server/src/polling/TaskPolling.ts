/**
 * Task Polling Service
 * 
 * Unified polling approach:
 * 1. Scan Loro Doc for nodes with pendingTask field
 * 2. Query Python API for task status
 * 3. Update Loro Doc when complete
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../types';
import { updateNodeData } from '../sync/NodeUpdater';

/**
 * Poll tasks for nodes that have pendingTask field
 * 
 * @returns true if there are still pending tasks
 */
export async function pollNodeTasks(
  doc: LoroDoc,
  env: Env,
  projectId: string,
  broadcast: (data: Uint8Array) => void
): Promise<boolean> {
  let hasPendingTasks = false;

  try {
    const nodesMap = doc.getMap('nodes');

    for (const [nodeId, nodeData] of nodesMap.entries()) {
      const data = nodeData as Record<string, any>;
      const innerData = data?.data || {};
      const pendingTask = innerData.pendingTask;

      if (!pendingTask) continue;

      // Skip if task is currently being submitted (taskState='submitted')
      const taskState = innerData.taskState;
      if (taskState === 'submitted') {
        console.log(`[TaskPolling] ⏸ Node ${nodeId.slice(0, 8)} is submitting, skipping poll`);
        hasPendingTasks = true;
        continue;
      }

      console.log(`[TaskPolling] 🔍 Checking task ${pendingTask} for node ${nodeId.slice(0, 8)}`);

      // Query Python API for task status
      const taskStatus = await getTaskStatus(env, pendingTask);
      console.log(`[TaskPolling] 📊 Task ${pendingTask}: ${taskStatus.status}`);

      if (taskStatus.status === 'completed') {
        const updates: Record<string, any> = {
          pendingTask: undefined,  // Clear pending task
          taskState: undefined,    // Clear task state
        };

        // Handle different task types
        if (taskStatus.result_url) {
          // Generation task completed - update src and status
          updates.src = taskStatus.result_url;
          updates.status = 'completed';
          console.log(`[TaskPolling] ✅ Generation complete: ${taskStatus.result_url}`);

          // If this is a video node, trigger thumbnail extraction
          const nodeType = data.type;
          if (nodeType === 'video' && taskStatus.result_url) {
            console.log(`[TaskPolling] 🎬 Video node detected, triggering thumbnail extraction`);

            // Extract R2 key from result URL
            // URL format: /api/assets/view/projects/{projectId}/assets/video-xxx.mp4
            const r2Key = extractR2KeyFromUrl(taskStatus.result_url);

            if (r2Key) {
              // Call Python API to extract thumbnail (fire and forget)
              extractThumbnail(env, projectId, nodeId, r2Key).catch(err =>
                console.error(`[TaskPolling] ❌ Thumbnail extraction failed:`, err)
              );
            }
          }
        } else if (taskStatus.result_data?.description) {
          // Description task completed - update description and status
          updates.description = taskStatus.result_data.description;
          updates.status = 'fin';
          console.log(`[TaskPolling] ✅ Description complete`);
        } else if (taskStatus.result_data?.cover_url) {
          // Thumbnail extraction completed - update coverUrl
          updates.coverUrl = taskStatus.result_data.cover_url;
          console.log(`[TaskPolling] ✅ Thumbnail complete: ${taskStatus.result_data.cover_url}`);
        }

        updateNodeData(doc, nodeId, updates, broadcast);
      } else if (taskStatus.status === 'failed') {
        console.error(`[TaskPolling] ❌ Task failed: ${taskStatus.error}`);

        // Fix: Don't mark as failed if it was already completed (e.g. description generation failed)
        // This prevents uploaded images from disappearing if description generation fails
        const currentStatus = innerData.status;

        if (currentStatus === 'completed' || currentStatus === 'fin') {
            console.warn(`[TaskPolling] ⚠️ Auxiliary task failed for ${nodeId.slice(0, 8)}, preserving asset status`);

            updateNodeData(doc, nodeId, {
              pendingTask: undefined,
              taskState: undefined,
              // Don't change status, just mark description as failed to prevent retry loops in NodeProcessor
              description: innerData.description || 'Description generation failed',
              // We can log the error but don't set the main error field to avoid UI confusion
              // error: taskStatus.error
            }, broadcast);
        } else {
            // Main generation task failed - this is a real failure
            updateNodeData(doc, nodeId, {
              pendingTask: undefined,
              taskState: undefined,
              status: 'failed',
              error: taskStatus.error
            }, broadcast);
        }
      } else {
        // Still pending/processing
        hasPendingTasks = true;
      }
    }
  } catch (error) {
    console.error('[TaskPolling] ❌ Error:', error);
  }

  return hasPendingTasks;
}

/**
 * Extract R2 key from asset URL
 * /api/assets/view/projects/xxx/assets/video.mp4 -> projects/xxx/assets/video.mp4
 */
function extractR2KeyFromUrl(url: string): string | null {
  const match = url.match(/\/api\/assets\/view\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Trigger thumbnail extraction for video
 */
async function extractThumbnail(
  env: Env,
  projectId: string,
  nodeId: string,
  videoR2Key: string
): Promise<void> {
  const apiUrl = `${env.BACKEND_API_URL}/api/extract-thumbnail`;

  console.log(`[TaskPolling] 📸 Calling thumbnail API: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_r2_key: videoR2Key,
        project_id: projectId,
        node_id: nodeId,
        timestamp: 1.0
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[TaskPolling] ❌ Thumbnail API error: ${response.status} - ${error}`);
      return;
    }

    const result = await response.json() as { cover_url: string; cover_r2_key: string };
    console.log(`[TaskPolling] ✅ Thumbnail extracted: ${result.cover_url}`);

    // The thumbnail URL will be picked up by the node in the next poll cycle
    // when we check for thumbnail extraction tasks
  } catch (error) {
    console.error(`[TaskPolling] ❌ Thumbnail extraction request failed:`, error);
  }
}

/**
 * Get task status from Python API
 */
async function getTaskStatus(
  env: Env,
  taskId: string
): Promise<{
  status: string;
  result_url?: string;
  result_data?: { description?: string; cover_url?: string };
  error?: string;
}> {
  try {
    const url = `${env.BACKEND_API_URL}/api/tasks/${taskId}`;
    console.log(`[TaskPolling] 📡 Fetching task status from: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[TaskPolling] ❌ HTTP ${response.status} error fetching task ${taskId}: ${text}`);
      return { status: 'failed', error: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json();
    console.log(`[TaskPolling] 📥 Task ${taskId} status:`, result);
    return result;
  } catch (e) {
    console.error(`[TaskPolling] ❌ Exception fetching task ${taskId}:`, e);
    return { status: 'failed', error: String(e) };
  }
}

/**
 * Trigger task polling alarm
 */
export async function triggerTaskPolling(state: DurableObjectState): Promise<void> {
  await state.storage.put('alarm_type', 'task_polling');
  await state.storage.setAlarm(Date.now() + 2000);
  console.log('[TaskPolling] ⏰ Scheduled poll in 2s');
}

/**
 * Check if any node has a pending task (for alarm scheduling)
 */
export function hasPendingTasks(doc: LoroDoc): boolean {
  try {
    const nodesMap = doc.getMap('nodes');
    for (const [, nodeData] of nodesMap.entries()) {
      const data = nodeData as Record<string, any>;
      if (data?.data?.pendingTask) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}
