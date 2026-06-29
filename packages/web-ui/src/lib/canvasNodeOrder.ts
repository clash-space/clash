type ParentableNode = {
  id: string;
  parentId?: string;
  extent?: unknown;
};

interface SanitizeNodesForReactFlowOptions<T extends ParentableNode> {
  onInvalidParent?: (node: T, parentId: string) => void;
}

function sameNodeOrder<T extends ParentableNode>(a: readonly T[], b: readonly T[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ReactFlow v12 requires parent nodes to appear before children.
export function sortNodesParentFirst<T extends ParentableNode>(nodes: readonly T[]): T[] {
  const nodeById = new Map<string, T>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  const result: T[] = [];
  const visited = new Set<string>();

  const visit = (node: T) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);

    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    if (parent) visit(parent);

    result.push(node);
  };

  for (const node of nodes) {
    visit(node);
  }

  return sameNodeOrder(result, nodes) ? (nodes as T[]) : result;
}

export function sanitizeNodesForReactFlow<T extends ParentableNode>(
  nodes: readonly T[],
  options: SanitizeNodesForReactFlowOptions<T> = {},
): T[] {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    nodeIds.add(node.id);
  }

  let cleanedNodes: T[] | null = null;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const parentId = node.parentId;
    if (!parentId || nodeIds.has(parentId)) continue;

    if (!cleanedNodes) {
      cleanedNodes = nodes.slice() as T[];
    }

    options.onInvalidParent?.(node, parentId);

    cleanedNodes[i] = {
      ...node,
      parentId: undefined,
      extent: undefined,
    };
  }

  return sortNodesParentFirst(cleanedNodes ?? nodes);
}
