/**
 * Node Update Utilities for Loro Document
 * Shared by ProjectRoom's hosted generation reconciliation paths.
 */

import { LoroDoc } from 'loro-crdt';
import {
  Canvas,
  deleteNodeUpstreamRef,
  listNodeOwnedEdges,
} from '@clash/shared-types';
import { log } from '../logger';

/**
 * Update specific data fields of a node and broadcast the change
 */
export function updateNodeData(
  doc: LoroDoc,
  nodeId: string,
  updates: Record<string, any>,
  broadcast: (data: Uint8Array) => void
): void {
  try {
    const versionBefore = doc.version();
    const nodesMap = doc.getMap('nodes');

    const existingNode = nodesMap.get(nodeId) as Record<string, any> | undefined;
    if (!existingNode) {
      log.warn(`Node not found for update: ${nodeId}`);
      return;
    }

    // Treat null as "delete this field" so callers can clear flags like
    // `pendingTask` (notifyFailed/notifyCompleted use null over the wire
    // because JSON.stringify drops undefined silently).
    const newData: Record<string, any> = { ...(existingNode.data || {}) };
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) delete newData[k];
      else newData[k] = v;
    }
    const updatedNode: Record<string, any> = {
      ...existingNode,
      data: newData,
    };

    // Ensure position is preserved
    if (!updatedNode.position) {
      updatedNode.position = existingNode.position || { x: 0, y: 0 };
    }

    nodesMap.set(nodeId, updatedNode);

    const update = doc.export({
      mode: 'update',
      from: versionBefore,
    });

    broadcast(update);
  } catch (error) {
    log.error(`Error updating node data:`, error);
  }
}

/**
 * Set or update an entire node in the Loro document
 */
export function updateNode(
  doc: LoroDoc,
  nodeId: string,
  nodeData: Record<string, any>,
  broadcast: (data: Uint8Array) => void
): void {
  try {
    const versionBefore = doc.version();
    const nodesMap = doc.getMap('nodes');

    nodesMap.set(nodeId, nodeData);

    const update = doc.export({
      mode: 'update',
      from: versionBefore,
    });

    broadcast(update);
  } catch (error) {
    log.error('Error updating node:', error);
  }
}

/**
 * Append a log entry to node's data._log array.
 * Logs are kept for debugging failed/in-progress tasks, cleared on success.
 */
export function appendNodeLog(
  doc: LoroDoc,
  nodeId: string,
  message: string,
  broadcast: (data: Uint8Array) => void
): void {
  try {
    const versionBefore = doc.version();
    const nodesMap = doc.getMap('nodes');
    const existingNode = nodesMap.get(nodeId) as Record<string, any> | undefined;
    if (!existingNode) return;

    const data = existingNode.data || {};
    const logs: string[] = Array.isArray(data._log) ? data._log : [];
    const entry = `${new Date().toISOString().slice(11, 19)} ${message}`;
    logs.push(entry);

    nodesMap.set(nodeId, {
      ...existingNode,
      data: { ...data, _log: logs },
    });

    broadcast(doc.export({ mode: 'update', from: versionBefore }));
  } catch {
    // Non-critical, don't let logging break the pipeline
  }
}

/**
 * Clear node logs (call on successful completion).
 */
export function clearNodeLog(
  doc: LoroDoc,
  nodeId: string,
  broadcast: (data: Uint8Array) => void
): void {
  updateNodeData(doc, nodeId, { _log: undefined }, broadcast);
}
export function updateEdge(
  doc: LoroDoc,
  edgeId: string,
  edgeData: Record<string, any>,
  broadcast: (data: Uint8Array) => void
): void {
  try {
    const versionBefore = doc.version();
    const source = typeof edgeData.source === 'string' ? edgeData.source : '';
    const target = typeof edgeData.target === 'string' ? edgeData.target : '';
    if (!source || !target) throw new Error('Edge source and target are required');

    const previous = listNodeOwnedEdges(doc).find((edge) => edge.id === edgeId);
    if (previous) {
      const rawPreviousTarget = doc.getMap('nodes').get(previous.target);
      deleteNodeUpstreamRef(doc, previous.target, edgeId, rawPreviousTarget);
    }
    const rawTarget = doc.getMap('nodes').get(target) as Record<string, any> | undefined;
    const canvasId = typeof rawTarget?.canvasId === 'string' ? rawTarget.canvasId : 'main';
    const canvas = new Canvas(doc, () => {}, canvasId);
    canvas.insertEdge(
      edgeId,
      source,
      target,
      typeof edgeData.type === 'string' ? edgeData.type : 'default',
      typeof edgeData.sourceHandle === 'string' ? edgeData.sourceHandle : undefined,
      typeof edgeData.targetHandle === 'string' ? edgeData.targetHandle : undefined,
    );
    doc.getMap('edges').delete(edgeId);

    const update = doc.export({
      mode: 'update',
      from: versionBefore,
    });

    broadcast(update);
  } catch (error) {
    log.error('Error updating edge:', error);
  }
}
