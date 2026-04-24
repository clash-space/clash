import { memo, useState, useCallback, useRef } from 'react';
import { Handle, Position, useReactFlow, type Node as RFNode } from '@xyflow/react';
import { Plus, Image as ImageIcon, VideoCamera, TextT, SpeakerHigh } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useProject } from '../ProjectContext';
import { useLayoutManager } from '@clash/web-ui/lib/layout';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { collectLayoutNodePatches, applyLayoutPatchesToLoro } from '@clash/web-ui/lib/loroNodeSync';
import { PIPELINE_MENU_OPTIONS, type PipelineMenuOption } from './pipelineMenuOptions';
import type { UseSpawnPendingAssetResult } from './useSpawnPendingAsset';

interface ActionBadgePipelineMenuProps {
    nodeId: string;
    spawnDraft: UseSpawnPendingAssetResult['spawnDraft'];
    canSpawn: boolean;
    disabledReason: string | null;
    outputKind: UseSpawnPendingAssetResult['outputKind'];
}

const OUTPUT_ICON = {
    image: ImageIcon,
    video: VideoCamera,
    audio: SpeakerHigh,
    text: TextT,
} as const;

/**
 * Right-handle flyout for action-badge nodes. Lazy-pipeline metaphor:
 *   • Primary row (A) spawns one draft output — the next stage, not yet running.
 *   • Secondary rows (B) spawn the draft AND wire it into a fresh downstream
 *     action, extending the pipe by a full stage in one click.
 *
 * Drafts are `status: 'idle'` — NodeProcessor ignores them. The user runs them
 * explicitly via the draft's own ▶ Run or ⏩ Run-chain buttons. Every click
 * here produces exactly one click's worth of nodes; the `xN` batch chip is a
 * Run concern and intentionally ignored.
 */
const ActionBadgePipelineMenu = ({ spawnDraft, canSpawn, disabledReason, outputKind }: ActionBadgePipelineMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const busyRef = useRef(false);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { projectId } = useProject();
    const { addEdges } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();

    const onNodesMutated = useCallback(
        (prevNodes: RFNode[], nextNodes: RFNode[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync],
    );
    const { addNodeWithAutoLayout } = useLayoutManager({ onNodesMutated });

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

    // Drag starting from the handle should dismiss the flyout so React Flow's
    // drag-to-connect gesture takes over cleanly. Same pattern as SourceHandleMenu.
    const handleDragStart = useCallback(() => {
        cancelLeave();
        setIsOpen(false);
    }, [cancelLeave]);

    const runLocked = useCallback(async (fn: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setIsBusy(true);
        try {
            await fn();
        } finally {
            busyRef.current = false;
            setIsBusy(false);
        }
    }, []);

    const handlePrimaryClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            if (!canSpawn) return;
            setIsOpen(false);
            void runLocked(async () => {
                try {
                    await spawnDraft();
                } catch (err) {
                    console.error('Pipeline draft spawn failed:', err);
                }
            });
        },
        [canSpawn, spawnDraft, runLocked],
    );

    const handleChainClick = useCallback(
        (option: PipelineMenuOption, e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            if (!canSpawn) return;
            setIsOpen(false);
            void runLocked(async () => {
                try {
                    const draftNode = await spawnDraft();
                    if (!draftNode) return;

                    const nextId = await generateSemanticId(projectId);
                    // Offset from the draft's actual width + a consistent gap —
                    // drafts are wide (~500px), so the default 300 puts the
                    // next action inside the draft's bounding box. Use the
                    // width we just set at creation; RF's measured width isn't
                    // available yet (ResizeObserver hasn't fired).
                    const draftWidth = typeof draftNode.width === 'number'
                        ? draftNode.width
                        : typeof draftNode.style?.width === 'number'
                            ? draftNode.style.width
                            : 500;
                    // The draft we just spawned has the same modality as this
                    // action's output — pass it as sourceKind so the chained
                    // action picks a model that can actually consume it.
                    const sourceKind = outputKind;
                    const nextNode = addNodeWithAutoLayout(
                        { id: nextId, type: option.nodeType, data: option.getNodeData(sourceKind) },
                        draftNode.id,
                        { x: draftWidth + 80, y: 0 },
                    );
                    if (!nextNode) return;

                    if (loroSync?.connected) {
                        loroSync.addNode(nextId, nextNode);
                    }

                    const edgeId = `${draftNode.id}-${nextId}`;
                    addEdges({ id: edgeId, source: draftNode.id, target: nextId, type: 'default' });
                    if (loroSync?.connected) {
                        loroSync.addEdge(edgeId, {
                            id: edgeId,
                            source: draftNode.id,
                            target: nextId,
                            type: 'default',
                        });
                    }
                } catch (err) {
                    console.error('Pipeline chain spawn failed:', err);
                }
            });
        },
        [canSpawn, spawnDraft, projectId, outputKind, addNodeWithAutoLayout, addEdges, loroSync, runLocked],
    );

    const PrimaryIcon = OUTPUT_ICON[outputKind];
    const disabled = !canSpawn || isBusy;
    const primaryTitle = disabled ? (disabledReason ?? 'Busy…') : `Add draft ${outputKind}`;

    return (
        <div
            className="absolute"
            style={{ top: '50%', right: '-8px', transform: 'translateY(-50%)' }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleDragStart}
        >
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
                        aria-label="Extend pipeline"
                    >
                        <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-xl backdrop-blur-xl min-w-[220px]">
                            <div className="px-2 py-1 text-xs font-bold text-slate-500 uppercase tracking-wider" aria-hidden="true">
                                Extend pipeline
                            </div>

                            {/* A-row — primary, spawns one draft output */}
                            <motion.button
                                type="button"
                                role="menuitem"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0 }}
                                onClick={handlePrimaryClick}
                                disabled={disabled}
                                title={primaryTitle}
                                aria-label={primaryTitle}
                                whileHover={disabled ? undefined : { x: 2 }}
                                whileTap={disabled ? undefined : { scale: 0.97 }}
                                className={`flex items-center gap-3 rounded-xl min-h-11 px-3 py-2.5 text-sm font-semibold text-left transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 ${
                                    disabled
                                        ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                        : 'bg-slate-900 text-white hover:bg-black cursor-pointer'
                                }`}
                            >
                                <Plus className="h-4 w-4 shrink-0" weight="bold" aria-hidden="true" />
                                <PrimaryIcon className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                                <span>Draft {outputKind}</span>
                            </motion.button>

                            {/* Divider */}
                            <div className="flex items-center gap-2 px-2 pt-1 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider" role="separator">
                                <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                                then chain
                                <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                            </div>

                            {/* B-rows — spawn draft + downstream action */}
                            {PIPELINE_MENU_OPTIONS
                                .filter((opt) => opt.isCompatibleWithSource(outputKind === 'text' ? undefined : outputKind))
                                .map((option, index) => {
                                const Icon = option.icon;
                                const rowDisabled = disabled;
                                const rowTitle = rowDisabled ? (disabledReason ?? 'Busy…') : `Draft → ${option.label}`;
                                return (
                                    <motion.button
                                        key={option.id}
                                        type="button"
                                        role="menuitem"
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: (index + 1) * 0.03 }}
                                        onClick={(e) => handleChainClick(option, e)}
                                        disabled={rowDisabled}
                                        title={rowTitle}
                                        aria-label={rowTitle}
                                        whileHover={rowDisabled ? undefined : { x: 2 }}
                                        whileTap={rowDisabled ? undefined : { scale: 0.97 }}
                                        className={`flex items-center gap-2.5 rounded-xl min-h-11 px-3 py-2.5 text-sm text-left transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 ${
                                            rowDisabled
                                                ? 'text-slate-500 opacity-60 cursor-not-allowed'
                                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                                        }`}
                                    >
                                        <Plus className="h-3.5 w-3.5 shrink-0 text-slate-500" weight="bold" aria-hidden="true" />
                                        <Icon className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                                        <span className="font-medium">Draft → {option.label}</span>
                                    </motion.button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default memo(ActionBadgePipelineMenu);
