import ELK, { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled';
import { Edge, Node } from '@xyflow/react';

const elk = new ELK();

// ELK options for a clean flowchart-like layout
const defaultOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '80', // Horizontal spacing
    'elk.layered.spacing.nodeNodeBetweenLayers': '100', // Horizontal spacing between layers
    'elk.spacing.edgeNode': '30',
    'elk.layered.spacing.edgeNodeBetweenLayers': '30',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]', // Padding inside groups
};

export const getLayoutedElements = async (nodes: Node[], edges: Edge[], options: any = {}) => {
    const _isHorizontal = options?.['elk.direction'] === 'RIGHT';

    // 1. Construct the ELK graph hierarchy
    // We need to nest nodes based on parentId
    const graphNodes: ElkNode[] = [];
    const nodeMap = new Map<string, ElkNode>();

    // Initialize all nodes
    nodes.forEach((node) => {
        const elkNode: ElkNode = {
            id: node.id,
            width: node.width ?? 150,
            height: node.height ?? 50,
            // Pass layout options specifically for this node if needed
            layoutOptions: {
                ...defaultOptions,
                ...options,
            },
            children: [],
            edges: [],
        };
        nodeMap.set(node.id, elkNode);
    });

    // Build hierarchy
    nodes.forEach((node) => {
        const elkNode = nodeMap.get(node.id)!;
        if (node.parentId) {
            const parent = nodeMap.get(node.parentId);
            if (parent) {
                parent.children?.push(elkNode);
            } else {
                // Parent not found (maybe filtered out), add to root
                graphNodes.push(elkNode);
            }
        } else {
            graphNodes.push(elkNode);
        }
    });

    // 2. Add edges - Filter to only valid edges
    const validEdges = edges.filter((edge) => {
        const hasSource = nodeMap.has(edge.source);
        const hasTarget = nodeMap.has(edge.target);
        
        if (!hasSource || !hasTarget) {
            console.warn(`[ELK] Skipping edge ${edge.id}: source=${edge.source} exists=${hasSource}, target=${edge.target} exists=${hasTarget}`);
            return false;
        }
        
        return true;
    });

    const elkEdges: ElkExtendedEdge[] = validEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
    }));

    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            ...defaultOptions,
            ...options,
            'elk.algorithm': 'layered',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN', // Important for groups
        },
        children: graphNodes,
        edges: elkEdges,
    };

    // 3. Run Layout
    try {
        const layoutedGraph = await elk.layout(graph);

        // 4. Map back to React Flow nodes
        const layoutedNodes: Node[] = [];

        const flattenGraph = (node: ElkNode) => {
            const originalNode = nodes.find((n) => n.id === node.id);
            if (originalNode) {
                layoutedNodes.push({
                    ...originalNode,
                    position: {
                        x: node.x!,
                        y: node.y!,
                    },
                    width: node.width,
                    height: node.height,
                    style: {
                        ...originalNode.style,
                        width: node.width,
                        height: node.height,
                    },
                });
            }

            if (node.children) {
                node.children.forEach((child) => flattenGraph(child));
            }
        };

        if (layoutedGraph.children) {
            layoutedGraph.children.forEach((child) => flattenGraph(child));
        }

        return { nodes: layoutedNodes, edges };
    } catch (error) {
        console.error('ELK Layout Failed:', error);
        return { nodes, edges }; // Return original on failure
    }
};

/**
 * Smart Layout: Preserves positions of fixed nodes and arranges others
 */
export const getSmartLayoutedElements = async (
    nodes: Node[],
    edges: Edge[],
    options: { fixedNodeIds?: string[] } = {}
) => {
    const fixedNodeIds = new Set(options.fixedNodeIds || []);

    // ELK options for interactive/incremental layout
    const layoutOptions = {
        ...defaultOptions,
        'elk.algorithm': 'layered',
        'elk.layered.layering.strategy': 'INTERACTIVE',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    };

    // 1. Construct the ELK graph hierarchy
    const graphNodes: ElkNode[] = [];
    const nodeMap = new Map<string, ElkNode>();

    nodes.forEach((node) => {
        const isFixed = fixedNodeIds.has(node.id);

        const elkNode: ElkNode = {
            id: node.id,
            width: node.width ?? 150,
            height: node.height ?? 50,
            layoutOptions: {
                ...layoutOptions,
                ...(isFixed
                    ? {
                          'elk.position': `(${node.position.x},${node.position.y})`,
                          'org.eclipse.elk.portConstraints': 'FIXED_POS',
                      }
                    : {}),
            },
            children: [],
            edges: [],
        };
        nodeMap.set(node.id, elkNode);
    });

    // Build hierarchy (same as getLayoutedElements)
    nodes.forEach((node) => {
        const elkNode = nodeMap.get(node.id)!;
        if (node.parentId) {
            const parent = nodeMap.get(node.parentId);
            if (parent) {
                parent.children?.push(elkNode);
            } else {
                graphNodes.push(elkNode);
            }
        } else {
            graphNodes.push(elkNode);
        }
    });

    // 2. Add edges - Filter to only valid edges
    const validEdges = edges.filter((edge) => {
        const hasSource = nodeMap.has(edge.source);
        const hasTarget = nodeMap.has(edge.target);
        
        if (!hasSource || !hasTarget) {
            console.warn(`[ELK Smart] Skipping edge ${edge.id}: source=${edge.source} exists=${hasSource}, target=${edge.target} exists=${hasTarget}`);
            return false;
        }
        
        return true;
    });

    const elkEdges: ElkExtendedEdge[] = validEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
    }));

    const graph: ElkNode = {
        id: 'root',
        layoutOptions: layoutOptions,
        children: graphNodes,
        edges: elkEdges,
    };

    // 3. Run Layout
    try {
        const layoutedGraph = await elk.layout(graph);

        // 4. Map back to React Flow nodes
        const layoutedNodes: Node[] = [];

        const flattenGraph = (node: ElkNode) => {
            const originalNode = nodes.find((n) => n.id === node.id);
            if (originalNode) {
                layoutedNodes.push({
                    ...originalNode,
                    position: {
                        x: node.x!,
                        y: node.y!,
                    },
                    width: node.width,
                    height: node.height,
                    style: {
                        ...originalNode.style,
                        width: node.width,
                        height: node.height,
                    },
                });
            }

            if (node.children) {
                node.children.forEach((child) => flattenGraph(child));
            }
        };

        if (layoutedGraph.children) {
            layoutedGraph.children.forEach((child) => flattenGraph(child));
        }

        return { nodes: layoutedNodes, edges };
    } catch (error) {
        console.error('ELK Smart Layout Failed:', error);
        return { nodes, edges };
    }
};

