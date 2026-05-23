import { memo, useState, useCallback, useRef, useMemo } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges, Node } from '@xyflow/react';
import type { Node as RFNode } from '@xyflow/react';
import { Copy } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useProject } from '../ProjectContext';
import { useLayoutManager } from '@clash/web-ui/lib/layout';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import type { Modality } from '@clash/shared-types';
import { collectLayoutNodePatches, applyLayoutPatchesToLoro } from '@clash/web-ui/lib/loroNodeSync';
import { PIPELINE_MENU_OPTIONS, type PipelineMenuOption } from './pipelineMenuOptions';
import { computeTrajectory, type TrajectorySubgraph } from './trajectoryPlan';
import CloneTrajectoryDialog from './CloneTrajectoryDialog';

interface SourceHandleMenuProps {
    nodeId: string;
}

const SourceHandleMenu = ({ nodeId }: SourceHandleMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [cloneDialog, setCloneDialog] = useState<TrajectorySubgraph | null>(null);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { projectId } = useProject();
    const { addEdges } = useReactFlow();
    const allNodes = useNodes();
    const allEdges = useEdges();
    const loroSync = useOptionalLoroSyncContext();

    const onNodesMutated = useCallback(
        (prevNodes: Node[], nextNodes: Node[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync]
    );
    const { addNodeWithAutoLayout, addNodeWithLayout } = useLayoutManager({ onNodesMutated });

    // Filter options by this source's modality — e.g. video source shouldn't
    // offer Image Gen because no mainstream image model accepts video refs.
    const sourceType = useMemo<Modality | undefined>(() => {
        const n = allNodes.find((nn) => nn.id === nodeId);
        const t = n?.type;
        return t === 'text' || t === 'image' || t === 'video' || t === 'audio' ? t : undefined;
    }, [allNodes, nodeId]);
    const visibleOptions = useMemo(() => {
        return PIPELINE_MENU_OPTIONS.filter((opt) => opt.isCompatibleWithSource(sourceType));
    }, [sourceType]);

    // Clone-trajectory option — only meaningful when this node was produced by
    // an upstream action chain (i.e. there's a trajectory to clone backward).
    // Head materials (uploads) have no incoming action edges → nothing to copy.
    const hasUpstreamTrajectory = useMemo(() => {
        const incoming = allEdges.filter((e) => e.target === nodeId);
        return incoming.some((e) => {
            const parent = allNodes.find((n) => n.id === e.source);
            return parent?.type === 'action-badge';
        });
    }, [allEdges, allNodes, nodeId]);

    const cancelLeave = useCallback(() => {
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }
    }, []);

    const handleMouseEnter = useCallback(() => {
        cancelLeave();
        setIsOpen(true);
    }, [cancelLeave]);

    const handleMouseLeave = useCallback(() => {
        leaveTimerRef.current = setTimeout(() => {
            setIsOpen(false);
        }, 200);
    }, []);

    const handleDragStart = useCallback(() => {
        cancelLeave();
        setIsOpen(false);
    }, [cancelLeave]);

    const handleOptionClick = useCallback(
        async (option: PipelineMenuOption, e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen(false);

            const newNodeId = await generateSemanticId(projectId);

            const newNode = addNodeWithAutoLayout(
                {
                    id: newNodeId,
                    type: option.nodeType,
                    data: option.getNodeData(sourceType),
                },
                nodeId
            );

            if (!newNode) return;

            if (loroSync?.connected) {
                loroSync.addNode(newNode.id, newNode);
            }

            const edgeId = `${nodeId}-${newNodeId}`;
            addEdges({
                id: edgeId,
                source: nodeId,
                target: newNodeId,
                type: 'default',
            });

            if (loroSync?.connected) {
                loroSync.addEdge(edgeId, {
                    id: edgeId,
                    source: nodeId,
                    target: newNodeId,
                    type: 'default',
                });
            }
        },
        [nodeId, projectId, addNodeWithAutoLayout, addEdges, loroSync, sourceType]
    );

    const handleCloneClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen(false);
            const sub = computeTrajectory(nodeId, allNodes as RFNode[], allEdges);
            // Need at least one cloneset node (i.e. more than just heads) to be useful.
            const clonesetSize = sub.nodeIds.size - sub.headIds.size;
            if (clonesetSize <= 0) return;
            setCloneDialog(sub);
        },
        [nodeId, allNodes, allEdges],
    );

    const handleCloneApply = useCallback(
        ({ newNodes, newEdges }: { newNodes: RFNode[]; newEdges: import('@xyflow/react').Edge[] }) => {
            // Route every cloned node through the canonical layout pipeline
            // (same path the toolbar "+" / spawnDraft uses) so the layout
            // manager handles collision avoidance against existing canvas
            // nodes, group auto-scaling, and chain-reaction collision
            // resolution. Each call sees the prior insertions, so multiple
            // clones in one batch don't stack on top of each other either.
            for (const n of newNodes) {
                if (!n.type) continue;
                const placed = addNodeWithLayout(
                    { id: n.id, type: n.type, data: n.data },
                    n.position,
                    undefined,
                );
                if (placed && loroSync?.connected) {
                    loroSync.addNode(placed.id, placed);
                }
            }
            for (const ed of newEdges) {
                addEdges(ed);
                if (loroSync?.connected) loroSync.addEdge(ed.id, ed);
            }
            setCloneDialog(null);
        },
        [addNodeWithLayout, addEdges, loroSync],
    );

    return (
        <div
            className="absolute"
            style={{ top: '50%', right: '-8px', transform: 'translateY(-50%)' }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleDragStart}
        >
            {/* React Flow handle */}
            <Handle
                type="source"
                position={Position.Right}
                style={{ position: 'relative', top: 0, right: 0, transform: 'none' }}
                className={`!h-4 !w-4 !border-4 !border-white transition-all duration-200 shadow-sm ${
                    isOpen
                        ? '!bg-slate-900 scale-[1.3]'
                        : '!bg-slate-400 hover:!bg-slate-700 hover:scale-125'
                }`}
            />

            {/* Flyout menu — mirrors left toolbar submenu style */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, x: -6, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -6, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute z-50 motion-reduce:transition-none"
                        style={{ top: '50%', left: 'calc(100% + 16px)', transform: 'translateY(-50%)' }}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                        role="menu"
                        aria-label="Add next or clone"
                    >
                        <div className="flex flex-col gap-1.5 rounded-2xl border border-warm-border bg-white/95 p-2.5 shadow-xl backdrop-blur-xl min-w-[180px]">
                            {/* Header */}
                            <div className="px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider" aria-hidden="true">
                                Add next
                            </div>

                            {/* Options */}
                            {visibleOptions.map((option, index) => {
                                const Icon = option.icon;
                                return (
                                    <motion.button
                                        key={option.id}
                                        role="menuitem"
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.03 }}
                                        className="flex items-center gap-3 rounded-xl min-h-11 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-colors motion-reduce:transition-none text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                                        whileHover={{ x: 2 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={(e) => handleOptionClick(option, e)}
                                        aria-label={`Add ${option.label} downstream`}
                                    >
                                        <Icon className="h-5 w-5 shrink-0" weight="regular" aria-hidden="true" />
                                        <span className="font-medium">{option.label}</span>
                                    </motion.button>
                                );
                            })}

                            {/* Clone-trajectory row — only when this node was produced by
                                an upstream action chain (nothing to clone on fresh uploads). */}
                            {hasUpstreamTrajectory && (
                                <>
                                    <div className="flex items-center gap-2 px-2 pt-1 pb-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider" role="separator">
                                        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                                        or clone upstream
                                        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                                    </div>
                                    <motion.button
                                        role="menuitem"
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: (visibleOptions.length + 1) * 0.03 }}
                                        className="flex items-center gap-3 rounded-xl min-h-11 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-colors motion-reduce:transition-none text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
                                        whileHover={{ x: 2 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={handleCloneClick}
                                        title="Duplicate the upstream trajectory as fresh drafts"
                                        aria-label="Clone upstream trajectory — opens a preview dialog"
                                    >
                                        <Copy className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                                        <span className="font-medium">Clone trajectory</span>
                                    </motion.button>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {cloneDialog && (
                <CloneTrajectoryDialog
                    open={true}
                    subgraph={cloneDialog}
                    nodes={allNodes as RFNode[]}
                    edges={allEdges}
                    projectId={projectId}
                    onApply={handleCloneApply}
                    onCancel={() => setCloneDialog(null)}
                />
            )}
        </div>
    );
};

export default memo(SourceHandleMenu);
