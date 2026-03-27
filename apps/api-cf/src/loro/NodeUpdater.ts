/**
 * Node Update Utilities for Loro Document
 * Ported from loro-sync-server/src/sync/NodeUpdater.ts — no changes needed.
 */

import { LoroDoc } from 'loro-crdt';
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

    const updatedNode: Record<string, any> = {
      ...existingNode,
      data: {
        ...(existingNode.data || {}),
        ...updates,
      },
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
    const edgesMap = doc.getMap('edges');

    edgesMap.set(edgeId, edgeData);

    const update = doc.export({
      mode: 'update',
      from: versionBefore,
    });

    broadcast(update);
  } catch (error) {
    log.error('Error updating edge:', error);
  }
}
