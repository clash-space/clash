import { memo, useState, useCallback, useRef } from 'react';
import { Handle, Position, useReactFlow, Node } from 'reactflow';
import { Image as ImageIcon, VideoCamera, FilmSlate, Plus } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useProject } from '../ProjectContext';
import { useLayoutManager } from '@/lib/layout';
import { generateSemanticId } from '@/lib/utils/semanticId';
import { collectLayoutNodePatches, applyLayoutPatchesToLoro } from '../../lib/loroNodeSync';
import { MODEL_CARDS } from '@clash/shared-types';

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image');
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video');

interface MenuOption {
    id: string;
    label: string;
    icon: typeof ImageIcon;
    nodeType: string;
    nodeData: Record<string, unknown>;
}

/**
 * To add a new option, just append to this array.
 * The menu layout is a vertical list — no layout math needed.
 */
const MENU_OPTIONS: MenuOption[] = [
    {
        id: 'image-gen',
        label: 'Image Gen',
        icon: ImageIcon,
        nodeType: 'action-badge',
        nodeData: {
            label: 'Image Prompt',
            actionType: 'image-gen',
            modelId: defaultImageModel?.id ?? 'nano-banana-2',
            model: defaultImageModel?.id ?? 'nano-banana-2',
            modelParams: { ...(defaultImageModel?.defaultParams ?? {}) },
            referenceMode: defaultImageModel?.input.referenceMode ?? 'single',
            content: '# Prompt\nEnter your prompt here...',
        },
    },
    {
        id: 'video-gen',
        label: 'Video Gen',
        icon: VideoCamera,
        nodeType: 'action-badge',
        nodeData: {
            label: 'Video Prompt',
            actionType: 'video-gen',
            modelId: defaultVideoModel?.id ?? 'sora-2-image-to-video',
            model: defaultVideoModel?.id ?? 'sora-2-image-to-video',
            modelParams: { ...(defaultVideoModel?.defaultParams ?? {}) },
            referenceMode: defaultVideoModel?.input.referenceMode ?? 'single',
            content: '# Prompt\nEnter your prompt here...',
        },
    },
    {
        id: 'video-editor',
        label: 'Video Editor',
        icon: FilmSlate,
        nodeType: 'video-editor',
        nodeData: {
            label: 'Video Editor',
            inputs: [],
        },
    },
];

interface SourceHandleMenuProps {
    nodeId: string;
}

const SourceHandleMenu = ({ nodeId }: SourceHandleMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { projectId } = useProject();
    const { addEdges } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();

    const onNodesMutated = useCallback(
        (prevNodes: Node[], nextNodes: Node[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync]
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

    const handleDragStart = useCallback(() => {
        cancelLeave();
        setIsOpen(false);
    }, [cancelLeave]);

    const handleOptionClick = useCallback(
        async (option: MenuOption, e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen(false);

            const newNodeId = await generateSemanticId(projectId);

            const newNode = addNodeWithAutoLayout(
                {
                    id: newNodeId,
                    type: option.nodeType,
                    data: { ...option.nodeData },
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
        [nodeId, projectId, addNodeWithAutoLayout, addEdges, loroSync]
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
                        className="absolute z-50"
                        style={{ top: '50%', left: 'calc(100% + 16px)', transform: 'translateY(-50%)' }}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                    >
                        <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white/90 p-2.5 shadow-xl backdrop-blur-xl min-w-[160px]">
                            {/* Header */}
                            <div className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Add next
                            </div>

                            {/* Options */}
                            {MENU_OPTIONS.map((option, index) => {
                                const Icon = option.icon;
                                return (
                                    <motion.button
                                        key={option.id}
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.03 }}
                                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors text-left cursor-pointer"
                                        whileHover={{ x: 2 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={(e) => handleOptionClick(option, e)}
                                    >
                                        <Icon className="h-5 w-5 shrink-0" weight="regular" />
                                        <span className="font-medium">{option.label}</span>
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

export default memo(SourceHandleMenu);
