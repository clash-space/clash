
import React, { memo, useMemo, useState, useCallback, useEffect, useId, useRef, createContext, useContext, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    BackgroundVariant,
    NodeToolbar,
    Position,
    useNodesState,
    useEdgesState,
    type NodeProps,
    type Node as RFNode,
    type Edge,
} from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, CheckCircle, FilePlus } from '@phosphor-icons/react';
import ImageNode from './ImageNode';
import VideoNode from './VideoNode';
import TextNode from './TextNode';
import AudioNode from './AudioNode';
import ActionBadgeNode from './ActionBadge';
import VideoEditorNode from './VideoEditorNode';
import { applyTrajectory, type TrajectorySubgraph } from './trajectoryPlan';
import { useDialogA11y } from '@clash/web-ui/hooks/useDialogA11y';

interface CloneTrajectoryDialogProps {
    open: boolean;
    subgraph: TrajectorySubgraph;
    nodes: RFNode[];
    edges: Edge[];
    projectId: string;
    onApply: (payload: { newNodes: RFNode[]; newEdges: Edge[] }) => void;
    onCancel: () => void;
}

interface PreviewCtxShape {
    rootIds: Set<string>;
    onDelete: (actionId: string) => void;
    deletable: Set<string>;
}
const PreviewCtx = createContext<PreviewCtxShape>({ rootIds: new Set(), onDelete: () => { }, deletable: new Set() });

/**
 * Wrap a canvas-level node component for use inside the preview ReactFlow:
 *   • Overlay × button (via NodeToolbar top) on root nodes (no incoming edge)
 *     — clicking prunes the node from the preview subgraph.
 *   • Tag at bottom classifying each node: "REUSED" (root) vs "DRAFT" (cloned).
 *   • Disable pointer events on the inner renderer so the user can't
 *     accidentally edit prompts / hit Run / etc. inside the preview.
 *
 * Pan/zoom still works because those are handled at the ReactFlow container
 * level, not on the node content.
 */
function wrapPreviewNode<T extends Record<string, unknown>>(Inner: ComponentType<NodeProps<RFNode<T>>>): ComponentType<NodeProps<RFNode<T>>> {
    const Wrapped = (props: NodeProps<RFNode<T>>) => {
        const { rootIds, onDelete, deletable } = useContext(PreviewCtx);
        const isRoot = rootIds.has(props.id);
        const canDelete = deletable.has(props.id);
        return (
            <>
                {canDelete && (
                    <NodeToolbar isVisible position={Position.Top} offset={6}>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDelete(props.id); }}
                            aria-label="Drop this action and everything upstream that only feeds it"
                            className="flex items-center gap-1 min-h-9 h-9 px-3 rounded-full bg-warm-surface border border-slate-300 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-red-50 hover:border-red-300 hover:text-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            title="Drop this action and everything upstream that only feeds it — its output becomes a reused head"
                        >
                            <X size={11} weight="bold" aria-hidden="true" />
                            drop stage
                        </button>
                    </NodeToolbar>
                )}
                <NodeToolbar isVisible position={Position.Bottom} offset={6}>
                    {isRoot ? (
                        <span
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] uppercase tracking-wider font-bold text-emerald-800"
                            title="Copied into the new trajectory with completed content preserved"
                        >
                            <CheckCircle size={10} weight="fill" aria-hidden="true" />
                            head copy · completed
                        </span>
                    ) : (
                        <span
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 text-[10px] uppercase tracking-wider font-bold text-white"
                            title="Cloned as an empty draft placeholder — Build to fill"
                        >
                            <FilePlus size={10} weight="bold" aria-hidden="true" />
                            cloned · draft
                        </span>
                    )}
                </NodeToolbar>
                <div className="pointer-events-none">
                    <Inner {...props} />
                </div>
            </>
        );
    };
    Wrapped.displayName = `Preview(${Inner.displayName ?? Inner.name ?? 'Node'})`;
    return Wrapped;
}

/**
 * Build the wrapped node type registry lazily. Building at module scope hits
 * an import cycle (this module → ImageNode → SourceHandleMenu → this module),
 * and the `Node*` imports read as `undefined` during the initial evaluation
 * pass. By the time a component renders, ES module bindings have settled.
 */
function buildPreviewNodeTypes() {
    const cast = <T,>(c: T) => c as ComponentType<NodeProps<RFNode<Record<string, unknown>>>>;
    return {
        video: wrapPreviewNode(cast(VideoNode)),
        image: wrapPreviewNode(cast(ImageNode)),
        text: wrapPreviewNode(cast(TextNode)),
        context: wrapPreviewNode(cast(TextNode)),
        audio: wrapPreviewNode(cast(AudioNode)),
        'action-badge': wrapPreviewNode(cast(ActionBadgeNode)),
        'video-editor': wrapPreviewNode(cast(VideoEditorNode)),
    };
}

/** Strip flags that would mis-render in the preview (open modals, cascade tokens, etc.). */
function sanitizePreviewData(data: Record<string, unknown>): Record<string, unknown> {
    const d = { ...data };
    delete d.openPanel;
    delete d.runRequested;
    delete d.cascadeToken;
    delete d.cascadeCancel;
    delete d.cascadePropagated;
    delete d.failureReason;
    return d;
}

/**
 * Simple left-to-right layered layout for the preview. Original canvas
 * positions would leave large gaps / overlap after pruning, so we lay out
 * the subgraph fresh using longest-path depth from roots.
 *
 * Actions and their outputs sit on consecutive depth columns (action.depth
 * +1 = output.depth), so a chain reads like: head → action → output → action
 * → output → …
 */
function layoutPreview(ids: string[], edges: Edge[]): Map<string, { x: number; y: number }> {
    const idSet = new Set(ids);
    const inCount = new Map<string, number>();
    const outEdges = new Map<string, string[]>();
    for (const id of ids) inCount.set(id, 0);
    for (const e of edges) {
        if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
        inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
        const list = outEdges.get(e.source) ?? [];
        list.push(e.target);
        outEdges.set(e.source, list);
    }

    const depth = new Map<string, number>();
    const queue: string[] = [];
    for (const id of ids) {
        if ((inCount.get(id) ?? 0) === 0) {
            depth.set(id, 0);
            queue.push(id);
        }
    }

    // Kahn-style topo with longest-path depth assignment.
    const pendingIn = new Map(inCount);
    while (queue.length > 0) {
        const cur = queue.shift()!;
        const curD = depth.get(cur) ?? 0;
        for (const nxt of outEdges.get(cur) ?? []) {
            const prev = depth.get(nxt) ?? -Infinity;
            if (curD + 1 > prev) depth.set(nxt, curD + 1);
            const remain = (pendingIn.get(nxt) ?? 1) - 1;
            pendingIn.set(nxt, remain);
            if (remain === 0) queue.push(nxt);
        }
    }

    const byDepth = new Map<number, string[]>();
    for (const id of ids) {
        const d = depth.get(id) ?? 0;
        const bucket = byDepth.get(d) ?? [];
        bucket.push(id);
        byDepth.set(d, bucket);
    }

    // Horizontal spacing accommodates typical widths: action badges ~260,
    // asset nodes ~500. A 440px step keeps things tight without overlap.
    const H_STEP = 440;
    const V_STEP = 380;
    const out = new Map<string, { x: number; y: number }>();
    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    for (const d of depths) {
        const bucket = byDepth.get(d)!;
        // Stable ordering: keep insertion order; could be improved with
        // barycentric reordering if crossings become a problem.
        bucket.forEach((id, i) => {
            out.set(id, { x: d * H_STEP, y: i * V_STEP });
        });
    }
    return out;
}

/**
 * The actual ReactFlow preview — mounted inside the dialog's ReactFlowProvider
 * so its context is isolated from the main canvas.
 */
const PreviewCanvas = ({
    initialNodes,
    initialEdges,
    target,
    onPreviewChange,
}: {
    initialNodes: RFNode[];
    initialEdges: Edge[];
    target: string;
    onPreviewChange: (nodes: RFNode[], edges: Edge[]) => void;
}) => {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    // Built once per mount — stable ref avoids ReactFlow remounting nodes.
    const previewNodeTypes = useMemo(() => buildPreviewNodeTypes(), []);

    // Keep parent informed so Apply sees the latest state.
    useEffect(() => {
        onPreviewChange(nodes, edges);
    }, [nodes, edges, onPreviewChange]);

    const rootIds = useMemo(() => {
        const hasIn = new Set<string>();
        for (const e of edges) hasIn.add(e.target);
        const roots = new Set<string>();
        for (const n of nodes) if (!hasIn.has(n.id)) roots.add(n.id);
        return roots;
    }, [nodes, edges]);

    // Deletable = action-badge that, if dropped, would NOT promote any draft
    // data node to head position. Heads are reused from the canvas, so they
    // must already be `completed` (have a real src). Promoting a draft to
    // head would leave the clone starting from an empty placeholder.
    const deletable = useMemo(() => {
        const out = new Set<string>();
        // Build indexes once — reused across every candidate's drop simulation.
        // Cuts the inner BFS from O(E) per step to O(in-degree) per step.
        const nodeById = new Map<string, RFNode>();
        for (const n of nodes as RFNode[]) nodeById.set(n.id, n);
        const incomingByTarget = new Map<string, Edge[]>();
        for (const e of edges) {
            const list = incomingByTarget.get(e.target);
            if (list) list.push(e);
            else incomingByTarget.set(e.target, [e]);
        }

        for (const candidate of nodes) {
            if (candidate.type !== 'action-badge') continue;

            // Simulate drop: reverse BFS from target, skip edges out of candidate.
            const keep = new Set<string>([target]);
            const queue: string[] = [target];
            while (queue.length > 0) {
                const cur = queue.shift()!;
                const ins = incomingByTarget.get(cur);
                if (!ins) continue;
                for (const e of ins) {
                    if (e.source === candidate.id) continue;
                    if (keep.has(e.source)) continue;
                    keep.add(e.source);
                    queue.push(e.source);
                }
            }

            // Would-be roots in the simulated graph = kept nodes with no
            // incoming (ignoring candidate's out-edges).
            let ok = true;
            for (const keptId of keep) {
                const ins = incomingByTarget.get(keptId);
                let hasIncoming = false;
                if (ins) {
                    for (const e of ins) {
                        if (e.source === candidate.id) continue;
                        if (keep.has(e.source)) { hasIncoming = true; break; }
                    }
                }
                if (hasIncoming) continue;
                const kept = nodeById.get(keptId);
                if (!kept) continue;
                // An action-badge as root has no inputs → invalid clone state.
                if (kept.type === 'action-badge') { ok = false; break; }
                const status = (kept.data as Record<string, unknown> | undefined)?.status;
                if (status !== 'completed') { ok = false; break; }
            }
            if (ok) out.add(candidate.id);
        }
        return out;
    }, [nodes, edges, target]);

    const handleDelete = useCallback(
        (actionId: string) => {
            // Keep = nodes still reachable backward from target with actionId
            // severed. Single BFS; use an incoming-edges index so each step
            // is O(in-degree), not O(E).
            const incomingByTarget = new Map<string, Edge[]>();
            for (const e of edges) {
                const list = incomingByTarget.get(e.target);
                if (list) list.push(e);
                else incomingByTarget.set(e.target, [e]);
            }
            const keep = new Set<string>([target]);
            const queue: string[] = [target];
            while (queue.length > 0) {
                const cur = queue.shift()!;
                const ins = incomingByTarget.get(cur);
                if (!ins) continue;
                for (const e of ins) {
                    if (e.source === actionId) continue;
                    if (keep.has(e.source)) continue;
                    keep.add(e.source);
                    queue.push(e.source);
                }
            }
            setNodes((nds) => nds.filter((n) => keep.has(n.id)));
            setEdges((eds) => eds.filter((e) => keep.has(e.source) && keep.has(e.target)));
        },
        [edges, target, setNodes, setEdges],
    );

    const ctxValue = useMemo(() => ({ rootIds, onDelete: handleDelete, deletable }), [rootIds, handleDelete, deletable]);

    return (
        <PreviewCtx.Provider value={ctxValue}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={previewNodeTypes as unknown as Record<string, ComponentType<NodeProps>>}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag
                zoomOnScroll
                fitView
                minZoom={0.3}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
            >
                <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#e2e8f0" />
            </ReactFlow>
        </PreviewCtx.Provider>
    );
};

const CloneTrajectoryDialog = ({
    open,
    subgraph,
    nodes,
    edges,
    projectId,
    onApply,
    onCancel,
}: CloneTrajectoryDialogProps) => {
    const originalNodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

    const initialPreviewEdges = useMemo(() => {
        return edges.filter((e) => subgraph.nodeIds.has(e.source) && subgraph.nodeIds.has(e.target));
    }, [edges, subgraph.nodeIds]);

    // Build the initial preview: nodes = subgraph members, sanitized data,
    // freshly laid out left-to-right by depth (original canvas positions make
    // the preview look sparse / overlap after pruning).
    const initialPreviewNodes = useMemo(() => {
        const ids = Array.from(subgraph.nodeIds);
        const positions = layoutPreview(ids, initialPreviewEdges);
        const out: RFNode[] = [];
        for (const id of ids) {
            const src = originalNodeById.get(id);
            if (!src) continue;
            const pos = positions.get(id) ?? { x: 0, y: 0 };
            out.push({
                ...src,
                position: pos,
                // Strip parent-group so preview doesn't try to render group containers
                // we didn't include.
                parentId: undefined,
                extent: undefined,
                data: sanitizePreviewData((src.data ?? {}) as Record<string, unknown>),
                selected: false,
                dragging: false,
            });
        }
        return out;
    }, [subgraph, originalNodeById, initialPreviewEdges]);

    const [previewNodes, setPreviewNodes] = useState<RFNode[]>(initialPreviewNodes);
    const [previewEdges, setPreviewEdges] = useState<Edge[]>(initialPreviewEdges);
    const [applying, setApplying] = useState(false);

    const headerId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    useDialogA11y(dialogRef, { open, onClose: onCancel });

    const onPreviewChange = useCallback((n: RFNode[], e: Edge[]) => {
        setPreviewNodes(n);
        setPreviewEdges(e);
    }, []);

    const stats = useMemo(() => {
        const hasIn = new Set<string>();
        for (const e of previewEdges) hasIn.add(e.target);
        let reused = 0;
        let clones = 0;
        for (const n of previewNodes) {
            if (hasIn.has(n.id)) clones += 1;
            else reused += 1;
        }
        return { reused, clones };
    }, [previewNodes, previewEdges]);

    const handleApply = useCallback(async () => {
        setApplying(true);
        try {
            const payload = await applyTrajectory(previewNodes, previewEdges, originalNodeById, projectId);
            onApply(payload);
        } finally {
            setApplying(false);
        }
    }, [previewNodes, previewEdges, originalNodeById, projectId, onApply]);

    const content = (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-6 md:p-8">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                        onClick={onCancel}
                        aria-hidden="true"
                    />
                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={headerId}
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                        className="relative z-10 w-full sm:w-[92vw] max-w-6xl h-[calc(100dvh-1rem)] sm:h-[86vh] md:h-[80vh] bg-warm-surface rounded-xl sm:rounded-2xl shadow-2xl border border-warm-border overflow-hidden flex flex-col motion-reduce:transition-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex items-start justify-between gap-3 sm:gap-4 border-b border-warm-border shrink-0">
                            <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Clone trajectory</div>
                                <h2 id={headerId} className="text-sm sm:text-base font-bold text-slate-900">Drop upstream stages</h2>
                                <div className="hidden sm:block text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                                    The clone forks into its own independent trajectory — even heads are fresh nodes. Click <strong>drop stage</strong> on an action to remove it plus any upstream that only fed it; its output then becomes a head copy of the completed asset. Drops that would promote a draft to head are blocked.
                                </div>
                                <div className="sm:hidden text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                                    Tap <strong>drop stage</strong> to trim front stages. Drops that would leave a draft as head are blocked.
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                aria-label="Close clone trajectory dialog"
                                className="shrink-0 p-2.5 text-slate-700 dark:text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                            >
                                <X className="w-4 h-4" weight="bold" aria-hidden="true" />
                            </button>
                        </div>

                        {/* Preview canvas */}
                        <div className="flex-1 relative">
                            <ReactFlowProvider>
                                <PreviewCanvas
                                    initialNodes={initialPreviewNodes}
                                    initialEdges={initialPreviewEdges}
                                    target={subgraph.target}
                                    onPreviewChange={onPreviewChange}
                                />
                            </ReactFlowProvider>
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 border-t border-warm-border bg-warm-muted shrink-0">
                            <div className="text-xs text-slate-700 dark:text-slate-300 text-center sm:text-left order-2 sm:order-1" aria-live="polite" aria-atomic="true">
                                <strong className="text-emerald-700">{stats.reused}</strong> head cop{stats.reused === 1 ? 'y' : 'ies'} ·{' '}
                                <strong className="text-slate-900">{stats.clones}</strong> draft{stats.clones === 1 ? '' : 's'}
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 order-1 sm:order-2">
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    disabled={applying}
                                    className="w-full sm:w-auto min-h-11 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleApply}
                                    disabled={stats.clones === 0 || applying}
                                    className="flex items-center justify-center gap-1.5 w-full sm:w-auto min-h-11 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-black rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                                    title={stats.clones === 0 ? 'Nothing to clone' : 'Apply to canvas'}
                                    aria-busy={applying || undefined}
                                >
                                    <Copy size={12} weight="bold" aria-hidden="true" />
                                    {applying ? 'Applying…' : 'Apply'}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    if (typeof window === 'undefined') return null;
    return createPortal(content, document.body);
};

export default memo(CloneTrajectoryDialog);
