interface PendingAssetLoroWriter {
  addNode: (nodeId: string, node: PendingAssetNodeLike) => unknown;
  addEdge: (edgeId: string, edge: PendingAssetEdgeLike) => unknown;
  updateNode: (
    nodeId: string,
    patch: { data: Record<string, unknown> },
  ) => unknown;
}

interface PendingAssetNodeLike {
  id: string;
  [key: string]: unknown;
}

interface PendingAssetEdgeLike {
  id: string;
  source: string;
  target: string;
  type: string;
}

export function persistPendingAssetCreation(
  loroSync: PendingAssetLoroWriter | null,
  node: PendingAssetNodeLike,
  edge: PendingAssetEdgeLike,
): void {
  if (!loroSync) return;
  loroSync.addNode(node.id, node);
  loroSync.addEdge(edge.id, edge);
}

export function persistPendingAssetAdoption(
  loroSync: PendingAssetLoroWriter | null,
  nodeId: string,
  data: Record<string, unknown>,
): void {
  loroSync?.updateNode(nodeId, { data });
}
