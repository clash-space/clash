/**
 * Task Polling Service
 *
 * Polls D1 for completed/failed tasks and updates Loro nodes.
 * Uses `pendingTask` field as the indicator — no separate taskState lock.
 */

import { LoroDoc } from 'loro-crdt';
import type { Env } from '../config';
import { log } from '../logger';
import { updateNodeData } from './NodeUpdater';
import { getAssetByTaskId } from '../services/asset-store';
import { Status } from '../domain/canvas';

/**
 * Poll tasks for nodes that have pendingTask field.
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

      const taskStatus = await getTaskStatusDirect(env, pendingTask);

      if (taskStatus.status === Status.Completed) {
        const updates: Record<string, any> = {
          pendingTask: undefined,
        };

        if (taskStatus.result_url) {
          updates.src = taskStatus.result_url;
          updates.status = Status.Completed;

          if (taskStatus.result_data?.cover_url) {
            updates.coverUrl = taskStatus.result_data.cover_url;
          }
        }

        if (taskStatus.result_data?.description) {
          updates.description = taskStatus.result_data.description;
          // Keep status as completed — no more 'fin'
        }

        updateNodeData(doc, nodeId, updates, broadcast);
      } else if (taskStatus.status === Status.Failed) {
        log.error(`Task failed: ${taskStatus.error}`);

        const currentStatus = innerData.status;

        if (currentStatus === Status.Completed) {
          // Auxiliary task (description) failed — preserve asset, just clear pendingTask
          log.warn(`Auxiliary task failed for ${nodeId.slice(0, 8)}, preserving asset status`);
          updateNodeData(doc, nodeId, {
            pendingTask: undefined,
            description: innerData.description || 'Description generation failed',
          }, broadcast);
        } else {
          updateNodeData(doc, nodeId, {
            pendingTask: undefined,
            status: Status.Failed,
            error: taskStatus.error,
          }, broadcast);
        }
      } else {
        hasPendingTasks = true;
      }
    }
  } catch (error) {
    log.error('Error:', error);
  }

  return hasPendingTasks;
}

/**
 * Get task status — check D1 first, fall back to Workflow status.
 *
 * If D1 has no record yet, the Workflow may still be running or may have
 * failed before writing to D1. Check workflow.status() to detect failures.
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

    if (asset) {
      let metadataObj: Record<string, unknown> = {};
      if (asset.metadata) {
        try { metadataObj = JSON.parse(asset.metadata); } catch {}
      }

      // Prefer storageKey (R2 key like "projects/...") over public URL.
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
    }

    // No D1 record — check Workflow status to detect failures
    try {
      const instance = await env.GENERATION_WORKFLOW.get(taskId);
      const wfStatus = await instance.status();
      if (wfStatus.status === 'errored' || wfStatus.status === 'terminated') {
        return { status: Status.Failed, error: wfStatus.error?.message ?? 'Workflow failed' };
      }
    } catch {
      // Workflow instance not found — task may not have been created yet
    }

    return { status: Status.Pending };
  } catch (e) {
    log.error(`Exception fetching task ${taskId}:`, e);
    return { status: Status.Failed, error: String(e) };
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
