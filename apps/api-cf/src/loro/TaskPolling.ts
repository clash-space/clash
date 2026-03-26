/**
 * Task Polling Service
 *
 * Ported from loro-sync-server/src/polling/TaskPolling.ts.
 * Key change: getTaskStatus() now calls api-cf internal functions directly
 * instead of HTTP fetch to /api/tasks/:taskId.
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../config';
import { updateNodeData } from './NodeUpdater';
import { getAssetByTaskId } from '../services/asset-store';

/**
 * Poll tasks for nodes that have pendingTask field.
 * Now reads from D1 directly instead of HTTP.
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

      const taskState = innerData.taskState;
      if (taskState === 'submitted') {
        hasPendingTasks = true;
        continue;
      }

      console.log(`[TaskPolling] Checking task ${pendingTask} for node ${nodeId.slice(0, 8)}`);

      // Query D1 directly instead of HTTP
      const taskStatus = await getTaskStatusDirect(env, pendingTask);
      console.log(`[TaskPolling] Task ${pendingTask}: ${taskStatus.status}`);

      if (taskStatus.status === 'completed') {
        const updates: Record<string, any> = {
          pendingTask: undefined,
          taskState: undefined,
        };

        if (taskStatus.result_url) {
          updates.src = taskStatus.result_url;
          updates.status = 'completed';

          if (taskStatus.result_data?.cover_url) {
            updates.coverUrl = taskStatus.result_data.cover_url;
          }
        } else if (taskStatus.result_data?.description) {
          updates.description = taskStatus.result_data.description;
          updates.status = 'fin';
        } else if (taskStatus.result_data?.cover_url) {
          updates.coverUrl = taskStatus.result_data.cover_url;
        }

        updateNodeData(doc, nodeId, updates, broadcast);
      } else if (taskStatus.status === 'failed') {
        console.error(`[TaskPolling] Task failed: ${taskStatus.error}`);

        const currentStatus = innerData.status;

        if (currentStatus === 'completed' || currentStatus === 'fin') {
          console.warn(`[TaskPolling] Auxiliary task failed for ${nodeId.slice(0, 8)}, preserving asset status`);
          updateNodeData(doc, nodeId, {
            pendingTask: undefined,
            taskState: undefined,
            description: innerData.description || 'Description generation failed',
          }, broadcast);
        } else {
          updateNodeData(doc, nodeId, {
            pendingTask: undefined,
            taskState: undefined,
            status: 'failed',
            error: taskStatus.error,
          }, broadcast);
        }
      } else {
        hasPendingTasks = true;
      }
    }
  } catch (error) {
    console.error('[TaskPolling] Error:', error);
  }

  return hasPendingTasks;
}

/**
 * Get task status directly from D1 (no HTTP round-trip).
 */
async function getTaskStatusDirect(
  env: Env,
  taskId: string
): Promise<{
  status: string;
  result_url?: string;
  result_data?: { description?: string; cover_url?: string };
  error?: string;
}> {
  try {
    const asset = await getAssetByTaskId(env.DB, taskId);

    if (!asset) {
      return { status: 'pending' };
    }

    let metadataObj: Record<string, unknown> = {};
    if (asset.metadata) {
      try { metadataObj = JSON.parse(asset.metadata); } catch {}
    }

    // Prefer storageKey (R2 key like "projects/...") over public URL.
    // The frontend resolves R2 keys via the local proxy (/api/assets/view/...),
    // so we never expose the public R2 domain to the client.
    const resultUrl = asset.storageKey?.startsWith('projects/')
      ? asset.storageKey
      : asset.url || undefined;

    return {
      status: asset.status,
      result_url: resultUrl,
      result_data: {
        description: asset.description || undefined,
        cover_url: (metadataObj.cover_url as string) || undefined,
      },
      error: (metadataObj.error as string) || undefined,
    };
  } catch (e) {
    console.error(`[TaskPolling] Exception fetching task ${taskId}:`, e);
    return { status: 'failed', error: String(e) };
  }
}

/**
 * Check if any node has a pending task
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
