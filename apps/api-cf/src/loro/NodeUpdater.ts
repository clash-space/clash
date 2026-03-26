/**
 * Node Update Utilities for Loro Document
 * Ported from loro-sync-server/src/sync/NodeUpdater.ts — no changes needed.
 */

import { LoroDoc } from 'loro-crdt';

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
      console.warn(`[NodeUpdater] Node not found for update: ${nodeId}`);
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
    console.error(`[NodeUpdater] Error updating node data:`, error);
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
    console.error('[NodeUpdater] Error updating node:', error);
  }
}

/**
 * Set or update an edge in the Loro document
 */
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
    console.error('[NodeUpdater] Error updating edge:', error);
  }
}
