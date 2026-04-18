import type { Node } from '@xyflow/react';

type LoroNodeUpdater = {
    connected: boolean;
    updateNode: (nodeId: string, nodeData: any) => void;
};

export type NodePatch = { id: string; patch: any };

function pickStyle(style: Node['style'] | undefined): Record<string, unknown> | undefined {
    if (!style) return undefined;
    const picked: Record<string, unknown> = {};
    if ('width' in style) picked.width = (style as any).width;
    if ('height' in style) picked.height = (style as any).height;
    if ('zIndex' in style) picked.zIndex = (style as any).zIndex;
    return Object.keys(picked).length > 0 ? picked : undefined;
}

function samePoint(a: any, b: any): boolean {
    return !!a && !!b && a.x === b.x && a.y === b.y;
}

function sameStyle(a: any, b: any): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.width === b.width && a.height === b.height && a.zIndex === b.zIndex;
}

/**
 * Collect patches for layout-related fields only (position/parent/size/style/extent).
 * Skips node.data to avoid unintended overwrites.
 */
export function collectLayoutNodePatches(prevNodes: Node[], nextNodes: Node[]): NodePatch[] {
    const prevById = new Map(prevNodes.map((n) => [n.id, n]));
    const patches: NodePatch[] = [];

    for (const next of nextNodes) {
        const prev = prevById.get(next.id);
        if (!prev) continue; // new node handled elsewhere (addNode)

        const nextStyle = pickStyle(next.style);
        const prevStyle = pickStyle(prev.style);

        const patch: any = {};

        if (!samePoint(prev.position, next.position)) patch.position = next.position;
        if (prev.parentId !== next.parentId) patch.parentId = next.parentId;

        if (prev.width !== next.width) patch.width = next.width;
        if (prev.height !== next.height) patch.height = next.height;
        if (prev.extent !== next.extent) patch.extent = next.extent;

        if (!sameStyle(prevStyle, nextStyle)) patch.style = nextStyle;

        if (Object.keys(patch).length > 0) {
            patches.push({ id: next.id, patch });
        }
    }

    return patches;
}

export function applyLayoutPatchesToLoro(loro: LoroNodeUpdater | null | undefined, patches: NodePatch[]) {
    if (!loro?.connected) return;
    for (const { id, patch } of patches) {
        loro.updateNode(id, patch);
    }
}

