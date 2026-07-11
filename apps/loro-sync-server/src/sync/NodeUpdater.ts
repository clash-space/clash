/**
 * Node Update Utilities for Loro Document
 * 
 * Provides functions to update nodes and edges in the Loro CRDT document
 * and broadcast changes to connected clients.
 */

import { LoroDoc } from 'loro-crdt';
import {
  Canvas,
  deleteNodeUpstreamRef,
  listNodeOwnedEdges,
} from '@clash/shared-types';

/**
 * Update specific data fields of a node and broadcast the change
 * 
 * @param doc - Loro document instance
 * @param nodeId - ID of the node to update
 * @param updates - Partial data updates to merge
 * @param broadcast - Function to broadcast updates to clients
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
      console.warn(`[NodeUpdater] ⚠️ Node not found for update: ${nodeId}`);
      return;
    }
    
    // Log position before merge
    console.log(`[NodeUpdater] DEBUG: Updating node ${nodeId}, existing position:`, existingNode.position);
    
    // Merge updates into existing node data
    const updatedNode: Record<string, any> = {
      ...existingNode,
      data: {
        ...(existingNode.data || {}),
        ...updates,
      },
    };
    
    // Ensure position is preserved
    if (!updatedNode.position) {
      console.error(`[NodeUpdater] ❌ CRITICAL: position missing after merge for node ${nodeId}! Restoring from existingNode.`);
      updatedNode.position = existingNode.position || { x: 0, y: 0 };
    }
    
    console.log(`[NodeUpdater] DEBUG: Updated node ${nodeId}, new position:`, updatedNode.position);
    
    nodesMap.set(nodeId, updatedNode);
    
    const update = doc.export({
      mode: 'update',
      from: versionBefore,
    });
    
    broadcast(update);
    console.log(`[NodeUpdater] 📤 Node updated and broadcasted: ${nodeId}`);
  } catch (error) {
    console.error(`[NodeUpdater] ❌ Error updating node data:`, error);
  }
}

/**
 * Set or update an entire node in the Loro document
 * 
 * @param doc - Loro document instance
 * @param nodeId - ID of the node
 * @param nodeData - Complete node data
 * @param broadcast - Function to broadcast updates to clients
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
    console.log(`[NodeUpdater] Updated node: ${nodeId}`);
  } catch (error) {
    console.error('[NodeUpdater] Error updating node:', error);
  }
}

/**
 * Set or update an edge in the Loro document
 * 
 * @param doc - Loro document instance
 * @param edgeId - ID of the edge
 * @param edgeData - Complete edge data
 * @param broadcast - Function to broadcast updates to clients
 */
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
    console.log(`[NodeUpdater] Updated edge: ${edgeId}`);
  } catch (error) {
    console.error('[NodeUpdater] Error updating edge:', error);
  }
}
