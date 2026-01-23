'use client';

import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import ReactFlow, {
    Background,
    BackgroundVariant,
    useNodesState,
    useEdgesState,
    applyNodeChanges,
    addEdge,
    Connection,
    Edge,
    Node,
    NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FilmSlate,
    TextT,
    Image as ImageIcon,
    SpeakerHigh,
    MagicWand,
    Sparkle,
    ArrowCounterClockwise,
    ArrowClockwise,
    UploadSimple,
    Square,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { Project } from '@generated/client';
import ChatbotCopilot from './ChatbotCopilot';
import { updateProjectName } from '../actions';
import VideoNode from './nodes/VideoNode';
import ImageNode from './nodes/ImageNode';
import TextNode from './nodes/TextNode';
import AudioNode from './nodes/AudioNode';
import PromptActionNode from './nodes/ActionBadge'; // Renamed: ActionBadge -> PromptActionNode
import GroupNode from './nodes/GroupNode';
import VideoEditorNode from './nodes/VideoEditorNode';
import { MediaViewerProvider } from './MediaViewerContext';
import { ProjectProvider } from './ProjectContext';
import { VideoEditorProvider, useVideoEditor } from './VideoEditorContext';
import { getLayoutedElements } from '@/lib/utils/elkLayout';
import { LayoutActionsProvider } from './LayoutActionsContext';
import {
    getAbsoluteRect,
    getAbsolutePosition,
    rectContains,
    rectOverlaps,
    determineGroupOwnership,
    recursiveGroupScale,
    applyGroupScales,
    resolveCollisions,
    applyResolution,
    createMesh,
    getNestingDepth,
    isDescendant,
    relayoutToGrid,
    needsAutoLayout,
    autoInsertNode,
    applyAutoInsertResult,
    shrinkGroupsToFit,
} from '@/lib/layout';
import { generateSemanticId } from '@/lib/utils/semanticId';
import { useLoroSync } from '../hooks/useLoroSync';
import { LoroSyncProvider } from './LoroSyncContext';
import { MODEL_CARDS } from '@clash/shared-types';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '../lib/loroNodeSync';
import { calculateScaledDimensions } from './nodes/assetNodeSizing';

const CHILD_NODE_Z_INDEX_BASE = 1000;

interface ProjectEditorProps {
    project: Project; // messages removed
    initialPrompt?: string;
}

/**
 * Wrapper component that hides content when video editor is open.
 * Uses visibility:hidden to preserve layout and avoid re-renders on close.
 */
function HideWhenEditorOpen({ children }: { children: React.ReactNode }) {
    const { isOpen } = useVideoEditor();
    return (
        <div
            style={{
                visibility: isOpen ? 'hidden' : 'visible',
                pointerEvents: isOpen ? 'none' : 'auto',
            }}
            className="contents"
        >
            {children}
        </div>
    );
}

const nodeTypes = {
    video: VideoNode,
    image: ImageNode,
    text: TextNode,
    context: TextNode, // Remap context to TextNode
    audio: AudioNode,
    'action-badge': PromptActionNode, // Merged: Prompt + Action
    prompt: PromptActionNode, // Backward compatibility: old prompt nodes render as PromptActionNode
    group: GroupNode,
    'video-editor': VideoEditorNode,
};

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image');
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video');

const sanitizeNodes = (nodes: Node[]): Node[] => {
    const nodeIds = new Set(nodes.map(n => n.id));
    return nodes.map(node => {
        if (node.parentId && !nodeIds.has(node.parentId)) {
            console.warn(`[Sanitize] Removing invalid parentId ${node.parentId} from node ${node.id}`);
            // Reset to absolute position (or keep relative as absolute)
            // Since parent is missing, we can't calculate true absolute, so we just keep the values
            const { parentId: _, ...rest } = node;
            return { ...rest, parentId: undefined, extent: undefined };
        }
        return node;
    });
};

export default function ProjectEditor({ project, initialPrompt }: ProjectEditorProps) {
    // IMPORTANT: Start with empty canvas - Loro sync will populate from server
    // This ensures Loro is the single source of truth for nodes/edges
    // Legacy: project.nodes/edges from DB are now ignored
    const initialNodes: Node[] = [];
    const initialEdges: Edge[] = [];

    const [nodes, setNodesInternal] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Wrap setNodes to ALWAYS sanitize before setting - this prevents "Parent node X not found" errors
    // The sanitization must happen BEFORE nodes are set to state, not after
    const setNodes = useCallback((updater: Node[] | ((nodes: Node[]) => Node[])) => {
        setNodesInternal((currentNodes) => {
            const newNodes = typeof updater === 'function' ? updater(currentNodes) : updater;
            return sanitizeNodes(newNodes);
        });
    }, [setNodesInternal]);
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [projectName, setProjectName] = useState(project.name);

    // Loro CRDT sync
    const loroSync = useLoroSync({
        projectId: project.id,
        syncServerUrl: process.env.NEXT_PUBLIC_LORO_SYNC_URL || 'ws://localhost:8787',
        onNodesChange: (syncedNodes) => {
            // Loro is the SINGLE SOURCE OF TRUTH - use its state directly
            // Only preserve spatial state during active interaction (drag/resize).
            // Selection is UI-only and should NOT block remote/local layout updates.
            setNodes((currentNodes) => {
                const currentNodesMap = new Map(currentNodes.map(n => [n.id, n]));

                let processedNodes = syncedNodes.map(syncedNode => {
                    const currentNode = currentNodesMap.get(syncedNode.id);

                    // Fix: Ensure text nodes have correct dimensions (300x400)
                    // TextNode renders at w-[300px] h-[400px] but data might have wrong height
                    let correctedNode = syncedNode;
                    if (syncedNode.type === 'text') {
                        const currentHeight = syncedNode.height || syncedNode.style?.height;
                        const currentWidth = syncedNode.width || syncedNode.style?.width;

                        if (currentHeight !== 400 || currentWidth !== 300) {
                            correctedNode = {
                                ...syncedNode,
                                width: 300,
                                height: 400,
                                style: {
                                    ...syncedNode.style,
                                    width: 300,
                                    height: 400,
                                }
                            };
                        }
                    }

                    if (!currentNode) return correctedNode;

                    const isInteracting = !!(currentNode.dragging || currentNode.resizing);
                    return {
                        ...correctedNode, // Trust Loro for data + layout unless interacting
                        position: isInteracting ? currentNode.position : correctedNode.position,
                        parentId: isInteracting ? currentNode.parentId : correctedNode.parentId,
                        width: isInteracting ? currentNode.width : correctedNode.width,
                        height: isInteracting ? currentNode.height : correctedNode.height,
                        style: isInteracting ? currentNode.style : correctedNode.style,
                        // Always preserve UI-only flags
                        selected: currentNode.selected,
                        dragging: currentNode.dragging,
                        resizing: currentNode.resizing,
                    };
                });
                processedNodes = sanitizeNodes(processedNodes);

                // Auto-layout nodes with placeholder position (from backend or programmatic creation)
                const nodesToLayout = processedNodes.filter(needsAutoLayout);
                if (nodesToLayout.length > 0) {
                    console.log(`[ProjectEditor] Auto-laying out ${nodesToLayout.length} node(s)`);

                    // Get current edges for reference detection
                    // Note: We use the current edges state since onEdgesChange may have already updated them
                    const currentEdges = edges;

                    for (const node of nodesToLayout) {
                        const result = autoInsertNode(node.id, processedNodes, currentEdges);
                        processedNodes = applyAutoInsertResult(processedNodes, node.id, result);

                        console.log(
                            `[ProjectEditor] Auto-inserted ${node.id}: ` +
                            `pos=(${result.position.x}, ${result.position.y}), ` +
                            `ref=${result.referenceNodeId || 'none'}, ` +
                            `pushed=${result.pushedNodes.size}`
                        );

                        // Auto-scale parent groups
                        if (node.parentId) {
                            const scales = recursiveGroupScale(node.id, processedNodes);
                            if (scales.size > 0) {
                                processedNodes = applyGroupScales(processedNodes, scales);
                            }
                        }
                    }

                    // Sync layout changes back to Loro (after a microtask to avoid loops)
                    queueMicrotask(() => {
                        if (!loroSyncRef.current?.connected) return;

                        for (const node of nodesToLayout) {
                            const layoutedNode = processedNodes.find(n => n.id === node.id);
                            if (layoutedNode && !needsAutoLayout(layoutedNode)) {
                                loroSyncRef.current.updateNode(node.id, {
                                    position: layoutedNode.position,
                                });
                            }
                        }

                        // Also sync pushed nodes positions
                        for (const node of processedNodes) {
                            const original = syncedNodes.find(n => n.id === node.id);
                            if (original && !nodesToLayout.some(n => n.id === node.id)) {
                                if (node.position.x !== original.position.x || node.position.y !== original.position.y) {
                                    loroSyncRef.current?.updateNode(node.id, {
                                        position: node.position,
                                    });
                                }
                            }
                        }

                        // Sync group size changes
                        for (const node of processedNodes) {
                            const original = syncedNodes.find(n => n.id === node.id);
                            if (original && node.type === 'group') {
                                if (node.width !== original.width || node.height !== original.height) {
                                    loroSyncRef.current?.updateNode(node.id, {
                                        width: node.width,
                                        height: node.height,
                                        style: node.style,
                                    });
                                }
                            }
                        }
                    });
                }

                return processedNodes;
            });
        },
        onEdgesChange: (syncedEdges) => {
            setEdges(syncedEdges);
        },
    });

    // Ref to access loroSync in callbacks without causing re-renders
    const loroSyncRef = useRef(loroSync);
    useEffect(() => {
        loroSyncRef.current = loroSync;
    }, [loroSync]);



    // File upload state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingNodeType, setPendingNodeType] = useState<string | null>(null);

    // Sidebar state
    const [sidebarWidth, setSidebarWidth] = useState(384);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

	    // Selection state
	    const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);

	    // Always sanitize nodes before passing to ReactFlow to prevent "Parent node X not found" errors
	    // This is the final safety net - removes any invalid parentId references
	    const sanitizedNodes = useMemo(() => {
	        const nodeIds = new Set(nodes.map(n => n.id));
	        let sanitizedCount = 0;
	        const result = nodes.map(node => {
	            if (node.parentId && !nodeIds.has(node.parentId)) {
	                sanitizedCount++;
	                console.warn(`[ProjectEditor] Sanitizing node ${node.id}: removing invalid parentId "${node.parentId}"`);
	                // Explicitly create new object without parentId
	                return {
	                    id: node.id,
	                    type: node.type,
	                    position: node.position,
	                    data: node.data,
	                    width: node.width,
	                    height: node.height,
	                    style: node.style,
	                    className: node.className,
	                    selected: node.selected,
	                    dragging: node.dragging,
	                    resizing: node.resizing,
	                    // Explicitly set parentId to undefined
	                    parentId: undefined,
	                    extent: undefined,
	                } as Node;
	            }
	            return node;
	        });
	        if (sanitizedCount > 0) {
	            console.log(`[ProjectEditor] Sanitized ${sanitizedCount} nodes with invalid parentIds`);
	        }
	        return result;
	    }, [nodes]);

	    const applyAutoZIndex = useCallback((nodeList: Node[]): Node[] => {
	        const getTargetZIndex = (node: Node): number => {
	            const depth = getNestingDepth(node.id, nodeList);
	            return node.type === 'group' ? depth : CHILD_NODE_Z_INDEX_BASE + depth;
	        };

	        let changed = false;
	        const next = nodeList.map((node) => {
	            const targetZIndex = getTargetZIndex(node);
	            const raw = (node.style as any)?.zIndex;
	            const currentZIndex = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : undefined;

	            if (typeof currentZIndex === 'number' && Number.isFinite(currentZIndex) && currentZIndex === targetZIndex) {
	                return node;
	            }

	            changed = true;
	            return {
	                ...node,
	                style: {
	                    ...(node.style || {}),
	                    zIndex: targetZIndex,
	                },
	            };
	        });

	        return changed ? next : nodeList;
	    }, []);

	    // Normalize z-index so that child nodes are always clickable above their groups:
	    // - groups: zIndex = depth
	    // - non-groups: zIndex = 1000 + depth
	    useEffect(() => {
	        const next = applyAutoZIndex(nodes);
	        if (next === nodes) return;

	        setNodes(next);
	        applyLayoutPatchesToLoro(loroSync, collectLayoutNodePatches(nodes, next));
	    }, [nodes, setNodes, loroSync, applyAutoZIndex]);

	    // Custom onNodesChange to handle recursive resizing
	    const handleNodesChange = useCallback((changes: NodeChange[]) => {
	        setNodes((currentNodes) => {
	            let updatedNodes = applyNodeChanges(changes, currentNodes);

            // Check for dimension changes (resizing)
            const resizeChanges = changes.filter((c) => c.type === 'dimensions');
            if (resizeChanges.length > 0) {
                let hasUpdates = false;

                resizeChanges.forEach((change) => {
                    if (change.type === 'dimensions' && change.dimensions) {
                        const node = updatedNodes.find((n) => n.id === change.id);
                        if (!node) return;

                        // Update the node's dimensions in our temp list
                        const nodeIndex = updatedNodes.findIndex((n) => n.id === change.id);
                        if (nodeIndex !== -1) {
                            updatedNodes[nodeIndex] = {
                                ...updatedNodes[nodeIndex],
                                width: change.dimensions.width,
                                height: change.dimensions.height,
                                style: {
                                    ...updatedNodes[nodeIndex].style,
                                    width: change.dimensions.width,
                                    height: change.dimensions.height,
                                },
                            };
                        }

                        // CASE 1: If a GROUP is resized, check if any nodes should become children
                        if (node.type === 'group') {
                            const resizedGroup = updatedNodes[nodeIndex];
                            const groupAbsRect = getAbsoluteRect(resizedGroup, updatedNodes);

                            // Check all non-descendant nodes to see if they're now inside this group
                            updatedNodes.forEach((otherNode, otherIndex) => {
                                // Skip the group itself and its existing descendants
                                if (otherNode.id === node.id) return;
                                if (isDescendant(otherNode.id, node.id, updatedNodes)) return;

                                // Skip nodes that are ancestors of this group (can't put parent inside child)
                                if (isDescendant(node.id, otherNode.id, updatedNodes)) return;

                                const otherAbsRect = getAbsoluteRect(otherNode, updatedNodes);
                                const isInside = rectContains(groupAbsRect, otherAbsRect);
                                const wasInside = otherNode.parentId === node.id;

	                                if (isInside && !wasInside) {
	                                    const groupAbsPos = getAbsolutePosition(resizedGroup, updatedNodes);
	                                    const relativePos = {
	                                        x: otherAbsRect.x - groupAbsPos.x,
	                                        y: otherAbsRect.y - groupAbsPos.y,
	                                    };
	                                    updatedNodes[otherIndex] = {
	                                        ...otherNode,
	                                        parentId: node.id,
	                                        position: relativePos,
	                                        extent: undefined,
	                                    };
	                                    hasUpdates = true;
	                                }
	                            });
	                        }

                        // CASE 2: If a node with parentId is resized, scale parent groups
                        if (node.parentId) {
                            const scales = recursiveGroupScale(change.id, updatedNodes);
                            if (scales.size > 0) {
                                updatedNodes = applyGroupScales(updatedNodes, scales);
                                hasUpdates = true;

                                const mesh = createMesh({ cellWidth: 50, cellHeight: 50, maxColumns: 10 });
                                for (const groupId of scales.keys()) {
                                    const result = resolveCollisions(updatedNodes, groupId, mesh, { maxIterations: 10 });
                                    if (result.steps.length > 0) {
                                        updatedNodes = applyResolution(updatedNodes, result);
                                    }
                                }
                            }
                        }
                    }
                });

	                if (!hasUpdates) {
	                    // no-op
	                }

	                // Persist any derived layout changes caused by resizing (dimensions/group scaling/collision resolution)
	                // NOTE: We intentionally do NOT sync drag position changes here; those are handled in onNodeDragStop.
	                updatedNodes = applyAutoZIndex(updatedNodes);
	                const patches = collectLayoutNodePatches(currentNodes, updatedNodes);
	                applyLayoutPatchesToLoro(loroSync, patches);
	            }

	            // Always sanitize before returning to ReactFlow - removes invalid parentId references
	            // This prevents "Parent node X not found" errors when parent nodes are deleted
	            return sanitizeNodes(updatedNodes);
	        });

        // Handle node deletions - sync to Loro (Fallback if onNodesDelete doesn't fire)
        const removeChanges = changes.filter(c => c.type === 'remove');
        if (removeChanges.length > 0 && loroSync.connected) {
            removeChanges.forEach(change => {
                if (change.type === 'remove') {
                    loroSync.removeNode(change.id);
                }
            });
        }

    }, [setNodes, loroSync, applyAutoZIndex]);

    // Reliable sync handlers
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        if (loroSync.connected) {
            deletedNodes.forEach(node => {
                loroSync.removeNode(node.id);
            });
        }
    }, [loroSync]);

	    const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node, _allNodes: Node[]) => {
	        let patchesToSync: Array<{ id: string; patch: any }> = [];
	        let draggedNodePatch: any | null = null;

	        flushSync(() => {
	            setNodes((nds) => {
	                const currentNode = nds.find((n) => n.id === node.id) ?? node;
	                const draggedNode: Node = {
	                    ...currentNode,
	                    position: node.position,
	                    width: node.width ?? currentNode.width,
	                    height: node.height ?? currentNode.height,
	                };
	                (draggedNode as any).measured = (node as any).measured ?? (currentNode as any).measured;

	                // Group ownership is based on FULL CONTAINMENT:
	                // the node joins a group only when its rect is fully inside that group.
	                const nodeAbsRect = getAbsoluteRect(draggedNode, nds);
	                const ownership = determineGroupOwnership(nodeAbsRect, draggedNode.id, nds);

	                const nextNode: Node = {
	                    ...draggedNode,
	                    parentId: ownership.newParentId,
	                    position: ownership.relativePosition,
	                    extent: undefined,
	                };
	                (nextNode as any).parentNode = ownership.newParentId;

	                // If a group is nested, ensure it stays above its parent.
	                if (nextNode.type === 'group' && ownership.newParentId) {
	                    const parent = nds.find((n) => n.id === ownership.newParentId);
	                    const parentZIndex = Number((parent?.style as any)?.zIndex ?? 0);
	                    nextNode.style = {
	                        ...nextNode.style,
	                        zIndex: parentZIndex + 1,
	                    };
	                }

	                let updatedNodes = nds.map((n) => (n.id === draggedNode.id ? nextNode : n));

	                // Auto-resize ancestors to fit the moved node (including nested groups).
	                const scales = recursiveGroupScale(nextNode.id, updatedNodes);
	                if (scales.size > 0) {
	                    updatedNodes = applyGroupScales(updatedNodes, scales);

	                    const mesh = createMesh({ cellWidth: 50, cellHeight: 50, maxColumns: 10 });
	                    for (const groupId of scales.keys()) {
	                        const result = resolveCollisions(updatedNodes, groupId, mesh, { maxIterations: 10 });
	                        if (result.steps.length > 0) {
	                            updatedNodes = applyResolution(updatedNodes, result);
	                        }
	                    }
	                }

	                updatedNodes = applyAutoZIndex(updatedNodes);
	                draggedNodePatch = {
	                    position: nextNode.position,
	                    parentId: nextNode.parentId,
	                    parentNode: (nextNode as any).parentNode,
	                    extent: nextNode.extent,
	                    style: nextNode.style,
	                };

	                patchesToSync = collectLayoutNodePatches(nds, updatedNodes).filter((p) => p.id !== draggedNode.id);
	                return updatedNodes;
	            });
	        });

	        if (loroSync.connected && draggedNodePatch) {
	            loroSync.updateNode(node.id, draggedNodePatch);
	        }
	        applyLayoutPatchesToLoro(loroSync, patchesToSync);
	    }, [setNodes, loroSync, applyAutoZIndex]);

    const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
        setSelectedNodes(nodes);
    }, []);

    // Auto-save logic removed: Loro is the single source of truth.


    // Custom handleEdgesChange to sync edge deletions to Loro
    const handleEdgesChange = useCallback((changes: import('reactflow').EdgeChange[]) => {
        onEdgesChange(changes);

        // Handle edge deletions - sync to Loro
        const removeChanges = changes.filter(c => c.type === 'remove');
        if (removeChanges.length > 0 && loroSync.connected) {
            removeChanges.forEach(change => {
                if (change.type === 'remove') {
                    loroSync.removeEdge(change.id);
                }
            });
        }
    }, [onEdgesChange, loroSync]);

    const onConnect = useCallback(
        (params: Connection | Edge) => {
            setEdges((eds) => {
                const newEdges = addEdge(params, eds);
                // Find the newly added edge and sync to Loro
                const addedEdge = newEdges.find(e => 
                    e.source === (params as Connection).source && 
                    e.target === (params as Connection).target
                );
                if (addedEdge && loroSync.connected) {
                    loroSync.addEdge(addedEdge.id, addedEdge);
                }
                return newEdges;
            });
        },
        [setEdges, loroSync]
    );

    // Keyboard shortcuts for Undo/Redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if focus is in an input/textarea to avoid triggering undo when typing
            const activeElement = document.activeElement;
            const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || (activeElement as HTMLElement)?.contentEditable === 'true';

            if (isInput) return;

            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) {
                    if (loroSync.canRedo) {
                        e.preventDefault();
                        loroSync.redo();
                    }
                } else {
                    if (loroSync.canUndo) {
                        e.preventDefault();
                        loroSync.undo();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [loroSync]);

    const toolbarMenu = [
        {
            id: 'assets',
            label: 'Assets',
            icon: UploadSimple,
            items: [
                { id: 'image', label: 'Image', icon: ImageIcon },
                { id: 'video', label: 'Video', icon: FilmSlate },
                { id: 'audio', label: 'Audio', icon: SpeakerHigh },
            ]
        },
        {
            id: 'actions',
            label: 'Actions',
            icon: Sparkle,
            items: [
                { id: 'action-badge-image', label: 'Image Gen', icon: ImageIcon },
                { id: 'action-badge-video', label: 'Video Gen', icon: FilmSlate },
            ]
        },
        { id: 'video-editor', label: 'Editor', icon: FilmSlate },
        { id: 'group', label: 'Group', icon: Square },
        { id: 'text', label: 'Text', icon: TextT },
    ];

    const addNode = useCallback((type: string, extraData: any = {}) => {
        let nodeType = type;
        let nodeData: any = { label: `New ${type}`, ...extraData };
        const imageModelDefaults = {
            modelId: defaultImageModel?.id ?? 'nano-banana-pro',
            model: defaultImageModel?.id ?? 'nano-banana-pro',
            modelParams: { ...(defaultImageModel?.defaultParams ?? {}) },
            referenceMode: defaultImageModel?.input.referenceMode ?? 'single',
        };
        const videoModelDefaults = {
            modelId: defaultVideoModel?.id ?? 'kling-image2video',
            model: defaultVideoModel?.id ?? 'kling-image2video',
            modelParams: { ...(defaultVideoModel?.defaultParams ?? {}) },
            referenceMode: defaultVideoModel?.input.referenceMode ?? 'single',
        };

        if (type === 'action-badge-image' || type === 'image-gen') {
            nodeType = 'action-badge';
            nodeData = {
                label: 'Image Prompt',
                actionType: 'image-gen',
                ...imageModelDefaults,
                content: '# Prompt\nEnter your prompt here...',
                ...nodeData
            };
        } else if (type === 'action-badge-video' || type === 'video-gen') {
            nodeType = 'action-badge';
            nodeData = {
                label: 'Video Prompt',
                actionType: 'video-gen',
                ...videoModelDefaults,
                content: '# Prompt\nEnter your prompt here...',
                ...nodeData
            };
        } else if (type === 'text') {
            nodeData = { label: 'Text Node', content: '# Hello World\nDouble click to edit.', ...nodeData };
        } else if (type === 'context') {
            // Remap context creation to text node style but keep label if needed, or just treat as text
            nodeData = { label: 'Context', content: '# Context\nAdd background information here...', ...nodeData };
            // Note: We are using TextNode component for 'context' type now (via nodeTypes map),
            // so it will render as a TextNode.
        } else if (type === 'video-editor') {
            nodeData = { label: 'Video Editor', inputs: [], ...nodeData };
        }

        // If caller didn't specify a parentId, default to "current group context":
        // - Prefer the selected group (deepest if multiple)
        // - Otherwise, use the parentId of the first selected node (if any)
        let insertionParentId: string | undefined = extraData.parentId;
        if (!insertionParentId && selectedNodes.length > 0) {
            const byId = new Map(nodes.map((n) => [n.id, n]));
            const selectedGroups = selectedNodes
                .map((n) => byId.get(n.id) ?? n)
                .filter((n) => n.type === 'group');

            if (selectedGroups.length > 0) {
                insertionParentId = selectedGroups
                    .slice()
                    .sort((a, b) => getNestingDepth(b.id, nodes) - getNestingDepth(a.id, nodes))[0]?.id;
            } else {
                const first = byId.get(selectedNodes[0].id) ?? selectedNodes[0];
                insertionParentId = first.parentId;
            }
        }
        if (insertionParentId !== extraData.parentId) {
            extraData = { ...extraData, parentId: insertionParentId };
        }

        // For group nodes, calculate z-index
        let zIndex: number | undefined = undefined;
        if (nodeType === 'group') {
            if (extraData.parentId) {
                // Nested Group: Must be ABOVE parent
                const parent = nodes.find(n => n.id === extraData.parentId);
                const parentZIndex = Number(parent?.style?.zIndex ?? 0);
                zIndex = parentZIndex + 1;
            } else {
                // Root Group: Keep existing logic (behind other groups)
                const groupNodes = nodes.filter((n) => n.type === 'group');
                const minZIndex = groupNodes.reduce((min, n) => {
                    const nodeZIndex = Number(n.style?.zIndex ?? 0);
                    return Math.min(min, nodeZIndex);
                }, 0);
                zIndex = minZIndex - 1;
            }
        }

        const newNodeId = extraData.id || `${nodes.length + 1}-${Date.now()}`;

        setNodes((nds) => {
            // 1. Determine Dimensions FIRST
            let defaultWidth: number | undefined = 300;
            let defaultHeight: number | undefined = 300;
            let layoutWidth = 300;
            let layoutHeight = 300;

            if (nodeType === 'group') {
                defaultWidth = 400;
                defaultHeight = 400;
                layoutWidth = 400;
                layoutHeight = 400;
            } else if (nodeType === 'text') {
                defaultWidth = 300;
                defaultHeight = 400;
                layoutWidth = 300;
                layoutHeight = 400;
            } else if (nodeType === 'action-badge') {
                defaultWidth = 320;
                defaultHeight = 220;
                layoutWidth = 320;
                layoutHeight = 220;
            } else if (nodeType === 'prompt') {
                defaultWidth = 300;
                defaultHeight = 150;
                layoutWidth = 300;
                layoutHeight = 150;
            } else if (nodeType === 'video-editor') {
                defaultWidth = 400;
                defaultHeight = 225;
                layoutWidth = 400;
                layoutHeight = 225;
            }
            if (nodeType === 'image' || nodeType === 'video') {
                defaultWidth = undefined;
                defaultHeight = undefined;
                layoutWidth = 300;
                layoutHeight = 300;
            }
            if (
                (nodeType === 'image' || nodeType === 'video') &&
                Number.isFinite(extraData.naturalWidth) &&
                Number.isFinite(extraData.naturalHeight)
            ) {
                const scaled = calculateScaledDimensions(extraData.naturalWidth, extraData.naturalHeight);
                defaultWidth = scaled.width;
                defaultHeight = scaled.height;
                layoutWidth = scaled.width;
                layoutHeight = scaled.height;
            }

            // 2. Determine Position with Collision Detection
            let parentId = extraData.parentId;

            // Validate parentId exists
            if (parentId) {
                const parentExists = nds.find(n => n.id === parentId);
                if (!parentExists) {
                    console.warn(`Parent node ${parentId} not found in current nodes list (size: ${nds.length}), creating node at root level`);
                    parentId = undefined;
                }
            }

            let targetPos = { x: 100, y: 100 };

            // If no parentId, try to place to the right of the entire graph
            if (!parentId && nds.length > 0) {
                let maxX = -Infinity;
                let lastNodeY = 100; // Default Y if no nodes found (unlikely)

                nds.forEach(n => {
                    // Only consider root nodes or top-level groups
                    if (!n.parentId) {
                        const x = n.position.x + (n.width || Number(n.style?.width) || 300);
                        if (x > maxX) {
                            maxX = x;
                            // Track the Y of the right-most node to align with it
                            lastNodeY = n.position.y;
                        }
                    }
                });

                if (maxX > -Infinity) {
                    // Place to the right of the right-most node, aligned to its TOP (stable Y)
                    targetPos = {
                        x: maxX + 100,
                        y: lastNodeY // Align with the last node's Y instead of centering
                    };
                }
            }

            const upstreamList = Array.isArray(extraData.upstreamNodeIds) ? extraData.upstreamNodeIds : [];

            if (parentId) {
                // Start at top-left of group
                targetPos = { x: 50, y: 50 };

                // 1. Upstream Node Placement (Highest Priority)
                const primaryUpstream = upstreamList[0];
                if (primaryUpstream) {
                    const upstreamNode = nds.find(n => n.id === primaryUpstream);
                    if (upstreamNode) {
                        // Calculate Upstream Node's Absolute Position
                        const upstreamAbsPos = getAbsolutePosition(upstreamNode, nds);
                        const upstreamWidth = upstreamNode.width || Number(upstreamNode.style?.width) || 300;
                        const upstreamHeight = upstreamNode.height || Number(upstreamNode.style?.height) || 300;
                        const upstreamCenterY = upstreamAbsPos.y + (upstreamHeight / 2);

                        // Calculate Parent Group's Absolute Position
                        const parentGroup = nds.find(n => n.id === parentId);
                        const parentAbsPos = parentGroup ? getAbsolutePosition(parentGroup, nds) : { x: 0, y: 0 };

                        // Calculate Target Position Relative to Parent Group
                        // We want the new node to be to the right of the upstream node
                        const targetAbsX = upstreamAbsPos.x + upstreamWidth + 80;
                        const targetAbsY = upstreamCenterY - (layoutHeight / 2);

                        let relativeX = targetAbsX - parentAbsPos.x;
                        let relativeY = targetAbsY - parentAbsPos.y;

                        // Ensure the node is at least somewhat inside the group (or will cause expansion)
                        // If relativeX is negative, it means upstream is to the left of the group.
                        // We should probably place it at the left edge (padding) so the group expands left?
                        // Or just let it be negative and let the user/layout handle it?
                        // Current resize logic only handles expansion to right/bottom.
                        // So we should clamp to minimum padding if we want to avoid "jumping" or weirdness.
                        // BUT, if we clamp, it might be far from upstream.
                        // Let's try to place it at least at x=50 if it would be negative, to keep it inside.
                        // This effectively "pulls" the node into the group.

                        if (relativeX < 50) relativeX = 50;
                        if (relativeY < 50) relativeY = 50;

                        targetPos = {
                            x: relativeX,
                            y: relativeY
                        };
                    }
                }
                // 2. Layout Direction (Right vs Bottom)
                else {
                    const children = nds.filter(n => n.parentId === parentId);
                    if (children.length > 0) {
                        if (extraData.layoutDirection === 'right') {
                            // Find the right-most child
                            const rightMostChild = children.reduce((prev, current) => {
                                return (prev.position.x > current.position.x) ? prev : current;
                            });
                            const childWidth = rightMostChild.width || Number(rightMostChild.style?.width) || layoutWidth;

                            targetPos = {
                                x: rightMostChild.position.x + childWidth + 50,
                                y: rightMostChild.position.y // Keep same Y level
                            };
                        } else {
                            // Default: Vertical stacking (bottom)
                            const bottomChild = children.reduce((prev, current) => {
                                return (prev.position.y > current.position.y) ? prev : current;
                            });
                            const childHeight = bottomChild.height || Number(bottomChild.style?.height) || 200;
                            targetPos = {
                                x: 50,
                                y: bottomChild.position.y + childHeight + 50
                            };
                        }
                    }
                }
            } else {
                // Root level placement (e.g. new groups)
                if (nodeType === 'group') {
                    // Find the right-most group to avoid overlap
                    const existingGroups = nds.filter(n => n.type === 'group');
                    if (existingGroups.length > 0) {
                        const rightMostGroup = existingGroups.reduce((prev, current) => {
                            return (prev.position.x > current.position.x) ? prev : current;
                        });
                        const groupWidth = rightMostGroup.width || Number(rightMostGroup.style?.width) || 400;
                        targetPos = {
                            x: rightMostGroup.position.x + groupWidth + 100, // Add extra spacing for groups
                            y: rightMostGroup.position.y
                        };
                    }
                }
            }


            // Use mesh-based layout only for nodes inside groups
            // Root-level nodes use the calculated rightmost position directly
            let position = targetPos;
            const mesh = createMesh({ cellWidth: 50, cellHeight: 50, maxColumns: 10 });

            if (parentId) {
                // Inside a group: use mesh for collision-free placement
                const siblingRects = nds
                    .filter(n => n.parentId === parentId && n.type !== 'group')
                    .map(n => getAbsoluteRect(n, nds));
                position = mesh.findNonOverlappingPosition(
                    targetPos,
                    { width: layoutWidth, height: layoutHeight },
                    siblingRects
                );
            } else {
                // Root level: use the rightmost position directly
                // Only adjust if there's a direct overlap at the exact position
                const directRect = { x: targetPos.x, y: targetPos.y, width: layoutWidth, height: layoutHeight };
                const rootNodes = nds.filter(n => !n.parentId);
                const hasDirectOverlap = rootNodes.some(n => {
                    const nodeRect = getAbsoluteRect(n, nds);
                    return rectOverlaps(directRect, nodeRect);
                });

                if (hasDirectOverlap) {
                    // Shift right by default width + spacing to avoid overlap
                    position = { x: targetPos.x + layoutWidth + 50, y: targetPos.y };
                }
            }

            const baseStyle: Record<string, string | number | undefined> = nodeType === 'group' ? { width: layoutWidth, height: layoutHeight, zIndex } : {};
            if (defaultWidth && defaultHeight) {
                baseStyle.width = defaultWidth;
                baseStyle.height = defaultHeight;
            }

            const newNode: Node = {
                id: newNodeId,
                type: nodeType,
                data: nodeData,
                position,
                parentId,
                width: defaultWidth,
                height: defaultHeight,
                // CRITICAL FIX: Do NOT set extent: 'parent'.
                // If set to 'parent', React Flow restricts the node's movement to within the parent's bounds.
                // This prevents the user from dragging the node OUT of the group to detach it.
                // We want to allow dragging out, so we leave extent undefined.
                extent: undefined,
                style: baseStyle,
                className: nodeType === 'group' ? 'group-node' : '',
            };

            // 3. Update nodes with Recursive Group Resizing using new layout system
            let updatedNodes = [...nds, newNode];

            // Use new recursive group scale
            const scales = recursiveGroupScale(newNode.id, updatedNodes);
            if (scales.size > 0) {
                updatedNodes = applyGroupScales(updatedNodes, scales);

                // Resolve collisions caused by scaling
                for (const groupId of scales.keys()) {
                    const result = resolveCollisions(updatedNodes, groupId, mesh, { maxIterations: 10 });
                    if (result.steps.length > 0) {
                        updatedNodes = applyResolution(updatedNodes, result);
                    }
                }
            }

            updatedNodes = applyAutoZIndex(updatedNodes);
            const finalNodes = updatedNodes;

            // Persist derived layout updates (group resize / collision resolution)
            applyLayoutPatchesToLoro(loroSync, collectLayoutNodePatches(nds, finalNodes));

            // Sync new node to Loro
            const createdNode = finalNodes.find(n => n.id === newNodeId);
            if (createdNode && loroSync.connected) {
                loroSync.addNode(newNodeId, createdNode);
            }

            return finalNodes;
        });
        return newNodeId;
    }, [nodes, selectedNodes, setNodes, loroSync, applyAutoZIndex]);

    const updateNode = useCallback((nodeId: string, updates: Partial<Node>) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id !== nodeId) return node;
                return {
                    ...node,
                    ...updates,
                    // Merge data so callers can update nested props like autoRun/preAllocatedAssetId
                    data: {
                        ...(node.data || {}),
                        ...(updates.data || {}),
                    },
                };
            })
        );
    }, [setNodes]);

    const handleToolClick = (type: string) => {
        if (['image', 'video', 'audio'].includes(type)) {
            setPendingNodeType(type);
            if (fileInputRef.current) {
                // Reset value to ensure onChange fires even if selecting the same file again
                fileInputRef.current.value = '';

                // Set accept attribute based on type
                if (type === 'image') fileInputRef.current.accept = 'image/*';
                else if (type === 'video') fileInputRef.current.accept = 'video/*';
                else if (type === 'audio') fileInputRef.current.accept = 'audio/*';

                fileInputRef.current.click();
            }
        } else {
            addNode(type);
        }
    };

    const addAssetEdgeToEditor = useCallback((assetNodeId: string, editorNodeId: string) => {
        setEdges((eds) => {
            const exists = eds.some(
                (edge) =>
                    edge.source === assetNodeId &&
                    edge.target === editorNodeId &&
                    edge.targetHandle === 'assets'
            );
            if (exists) return eds;

            const edgeId = `edge-${assetNodeId}-${editorNodeId}-assets`;
            const newEdge: Edge = {
                id: edgeId,
                source: assetNodeId,
                target: editorNodeId,
                targetHandle: 'assets',
            };

            if (loroSync.connected) {
                loroSync.addEdge(edgeId, newEdge);
            }

            return [...eds, newEdge];
        });
    }, [setEdges, loroSync]);

    const uploadFileAsAssetNode = useCallback(
        async (
            file: File,
            assetType: 'image' | 'video' | 'audio',
            options?: { connectToVideoEditorId?: string }
        ): Promise<{ id: string; type: 'image' | 'video' | 'audio'; src: string; name: string; width?: number; height?: number } | null> => {
            const placeholderId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const localPreviewUrl = URL.createObjectURL(file);

            let mediaWidth: number | undefined;
            let mediaHeight: number | undefined;
            let videoDuration: number | undefined;

            if (file.type.startsWith('image/')) {
                try {
                    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => {
                            resolve({ width: img.naturalWidth, height: img.naturalHeight });
                        };
                        img.onerror = reject;
                        img.src = localPreviewUrl;
                    });
                    mediaWidth = dimensions.width;
                    mediaHeight = dimensions.height;
                    console.log(`[Upload] Image dimensions: ${mediaWidth}x${mediaHeight}`);
                } catch (err) {
                    console.warn('[Upload] Failed to read image dimensions:', err);
                }
            } else if (file.type.startsWith('video/')) {
                try {
                    const videoInfo = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
                        const video = document.createElement('video');
                        video.preload = 'metadata';
                        video.onloadedmetadata = () => {
                            resolve({
                                width: video.videoWidth,
                                height: video.videoHeight,
                                duration: video.duration || 0
                            });
                        };
                        video.onerror = () => reject(new Error('Failed to read video metadata'));
                        video.src = localPreviewUrl;
                    });
                    mediaWidth = videoInfo.width;
                    mediaHeight = videoInfo.height;
                    videoDuration = videoInfo.duration;
                } catch (err) {
                    console.warn('[Upload] Failed to read video metadata:', err);
                }
            }

            addNode(assetType, {
                id: placeholderId,
                label: file.name,
                status: 'uploading',
                src: localPreviewUrl,
                naturalWidth: mediaWidth,
                naturalHeight: mediaHeight,
                duration: videoDuration,
                createdAt: Date.now(), // Explicitly store creation time for sorting
            });

            if (options?.connectToVideoEditorId) {
                addAssetEdgeToEditor(placeholderId, options.connectToVideoEditorId);
            }

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectId', project.id);
                formData.append('type', assetType);

                const res = await fetch('/api/upload/asset', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(errorText || 'Failed to upload to R2');
                }

                const { url, storageKey } = await res.json();
                const finalSrc = storageKey || url;

                setNodes((nds) =>
                    nds.map((node) =>
                        node.id === placeholderId
                            ? {
                                ...node,
                                data: {
                                    ...node.data,
                                    src: finalSrc,
                                    storageKey,
                                    status: 'completed',
                                    duration: videoDuration,
                                },
                            }
                            : node
                    )
                );
                URL.revokeObjectURL(localPreviewUrl);

                if (loroSync.connected) {
                    loroSync.updateNode(placeholderId, {
                        data: {
                            src: finalSrc,
                            storageKey,
                            status: 'completed',
                            duration: videoDuration,
                        }
                    });
                }
                return {
                    id: placeholderId,
                    type: assetType,
                    src: finalSrc,
                    name: file.name,
                    width: mediaWidth,
                    height: mediaHeight,
                };
            } catch (err) {
                console.error('Failed to upload file to R2', err);
                setNodes((nds) =>
                    nds.map((node) =>
                        node.id === placeholderId
                            ? {
                                ...node,
                                data: {
                                    ...node.data,
                                    status: 'failed',
                                },
                            }
                            : node
                    )
                );
                URL.revokeObjectURL(localPreviewUrl);
                if (loroSync.connected) {
                    loroSync.updateNode(placeholderId, {
                        data: { status: 'failed' },
                    });
                }
                return null;
            }
        },
        [addNode, addAssetEdgeToEditor, loroSync, project.id, setNodes]
    );

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && pendingNodeType) {
            try {
                await uploadFileAsAssetNode(file, pendingNodeType as 'image' | 'video' | 'audio');
            } finally {
                setPendingNodeType(null);
                if (event.target) {
                    event.target.value = '';
                }
            }
        }
    };

    const handleEditorAssetAdded = useCallback(
        async (
            file: File,
            type: 'image' | 'video' | 'audio',
            editorNodeId: string
        ) => {
            if (!type || !editorNodeId) return null;
            return uploadFileAsAssetNode(file, type, { connectToVideoEditorId: editorNodeId });
        },
        [uploadFileAsAssetNode]
    );


    const handleCommand = useCallback(async (command: any) => {
        console.log('Executing command:', command);
        switch (command.type) {
            case 'ADD_NODE':
                let { type, data, ...rest } = command.payload;

                // Map legacy/agent types to action-badge
                if (type === 'image-gen') {
                    type = 'action-badge';
                    data = { actionType: 'image-gen', modelId: defaultImageModel?.id ?? 'nano-banana-pro', model: defaultImageModel?.id ?? 'nano-banana-pro', modelParams: { ...(defaultImageModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 60;
                } else if (type === 'video-gen') {
                    type = 'action-badge';
                    data = { actionType: 'video-gen', modelId: defaultVideoModel?.id ?? 'kling-image2video', model: defaultVideoModel?.id ?? 'kling-image2video', modelParams: { ...(defaultVideoModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 60;
                }

                // Validate parentId if present
                if (rest.parentId && !nodes.find(n => n.id === rest.parentId)) {
                    console.warn(`Parent node ${rest.parentId} not found in command, creating node at root level`);
                    delete rest.parentId;
                }

                // Generate semantic ID
                const nodeId = await generateSemanticId(project.id);

                const newNode: Node = {
                    id: nodeId,
                    type,
                    data,
                    ...rest,
                };

                // Add the new node
                const updatedNodes = nodes.concat(newNode);

                // User requested FULL AUTO-LAYOUT on every insertion ("don't worry about user layout")
                // So we use getLayoutedElements instead of getSmartLayoutedElements
                const { nodes: layoutedNodes, edges: layoutedEdges } = await getLayoutedElements(
                    updatedNodes,
                    edges,
                    { direction: 'RIGHT' } // Ensure consistent direction
                );

                setNodes(layoutedNodes);
                setEdges(layoutedEdges);
                break;
            // Add other cases as needed
            default:
                console.warn('Unknown command type:', command.type);
        }
    }, [nodes, edges, setNodes, setEdges, project.id]);

    const applyRelayout = useCallback(
        (currentNodes: Node[], currentEdges: Edge[], scopeParentId: string | undefined) => {
            let updated = [...currentNodes];

            // 1. Recursive group scale (ensure containers are large enough)
            const nodesToCheck = updated.filter((n) => n.parentId === scopeParentId);
            const mergedScales = new Map<string, { width: number; height: number }>();

            for (const node of nodesToCheck) {
                const scales = recursiveGroupScale(node.id, updated);
                for (const [groupId, size] of scales.entries()) {
                    const prev = mergedScales.get(groupId);
                    mergedScales.set(groupId, {
                        width: Math.max(prev?.width ?? 0, size.width),
                        height: Math.max(prev?.height ?? 0, size.height),
                    });
                }
            }
            if (mergedScales.size > 0) updated = applyGroupScales(updated, mergedScales);

            // 2. Relayout to grid
            updated = relayoutToGrid(updated, {
                gapX: 80,
                gapY: 60,
                centerInCell: false,
                scopeParentId: scopeParentId,
                edges: currentEdges,
                compact: true,
            });

            // 3. Post-layout scale (ensure containers fit new layout)
            const postLayoutScales = new Map<string, { width: number; height: number }>();
            const postLayoutNodesToCheck = updated.filter((n) => n.parentId === scopeParentId);

            for (const node of postLayoutNodesToCheck) {
                const scales = recursiveGroupScale(node.id, updated);
                for (const [groupId, size] of scales.entries()) {
                    const prev = postLayoutScales.get(groupId);
                    postLayoutScales.set(groupId, {
                        width: Math.max(prev?.width ?? 0, size.width),
                        height: Math.max(prev?.height ?? 0, size.height),
                    });
                }
            }
            if (postLayoutScales.size > 0) updated = applyGroupScales(updated, postLayoutScales);

            // 4. Shrink groups to fit
            updated = shrinkGroupsToFit(updated, scopeParentId, 40);

            // 5. Apply Z-Index
            updated = applyAutoZIndex(updated);

            return updated;
        },
        [applyAutoZIndex]
    );

    const relayoutParent = useCallback(
        (parentId: string | undefined) => {
            setNodes((current) => {
                const updated = applyRelayout(current, edges, parentId);
                applyLayoutPatchesToLoro(loroSync, collectLayoutNodePatches(current, updated));
                return updated;
            });
        },
        [setNodes, applyRelayout, loroSync, edges]
    );

    const onLayout = useCallback(() => {
        // Global relayout = relayout root-level (parentId undefined) only.
        relayoutParent(undefined);
    }, [relayoutParent]);


    const findNodeIdByName = useCallback((name: string): string | undefined => {
        const node = nodes.find(n => n.data?.label === name);
        return node?.id;
    }, [nodes]);

    return (
        <ProjectProvider projectId={project.id}>
            <LoroSyncProvider loroSync={loroSync}>
                <VideoEditorProvider
                    onAssetAddedToCanvas={handleEditorAssetAdded}
                    onCanvasAssetLinked={(asset, editorNodeId) => {
                        if (!asset.sourceNodeId) return;
                        addAssetEdgeToEditor(asset.sourceNodeId, editorNodeId);
                    }}
                    nodes={nodes}
                    edges={edges}
                >
                    <HideWhenEditorOpen>
                    <MediaViewerProvider>
                        <LayoutActionsProvider value={{ relayoutParent }}>
                        <div className="flex h-screen w-full flex-col bg-white overflow-hidden">
                        {/* Hidden File Input */}
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileChange}
                        />

                        {/* Top Toolbar */}


                        {/* Main Canvas Area */}
                        <div className="flex flex-1 overflow-hidden relative">
                            {/* Logo + Project Name - No Background */}
                            <div id="editor-header" className="absolute top-6 left-[36px] z-[60] flex items-center pointer-events-auto">
                                <Link href="/" className="group">
                                    <motion.div
                                        className="flex items-center gap-1"
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        <span className="font-display text-4xl font-bold tracking-tighter text-gray-900 leading-none">
                                            C
                                        </span>
                                        <div className="h-8 w-[6px] bg-brand -skew-x-[20deg] transform origin-center" />
                                    </motion.div>
                                </Link>

                                {/* Separator - Aligned with Toolbar Right Edge (88px from viewport left) */}
                                <div className="absolute left-[52px] h-8 w-px bg-slate-300" />

                                {/* Project Name Input */}
                                <input
                                    className="absolute left-[65px] bg-transparent text-base font-display font-medium text-slate-900 focus:outline-none focus:ring-0 placeholder-slate-400 min-w-[60px]"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    onBlur={() => {
                                        if (projectName !== project.name) {
                                            updateProjectName(project.id, projectName);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.currentTarget.blur();
                                        }
                                    }}
                                    placeholder="Untitled"
                                />
                            </div>
                            <div className="absolute inset-0 z-0">
                                <ReactFlow
                                    nodes={sanitizedNodes}
                                    edges={edges}
                                    onNodesChange={handleNodesChange}
                                    onEdgesChange={handleEdgesChange}
                                    onNodesDelete={onNodesDelete}
                                    onNodeDragStop={onNodeDragStop}
                                    onConnect={onConnect}
                                    onSelectionChange={onSelectionChange}

                                    nodeTypes={nodeTypes}
                                    fitView
                                    minZoom={0.1}
                                    proOptions={{ hideAttribution: true }}
                                >
                                    <Background
                                        variant={BackgroundVariant.Dots}
                                        gap={12}
                                        size={1.5}
                                        color="var(--canvas-dot)"
                                        style={{ backgroundColor: 'var(--canvas-bg)' }}
                                    />

                                </ReactFlow>
                            </div>

                            {/* Left Toolbar - Vertical Palette */}
                            <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2 pointer-events-none">
                                 <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-full border border-slate-200 bg-white/80 py-6 px-3 shadow-lg backdrop-blur-xl transition-all">
                                    {toolbarMenu.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = activeMenu === item.id;
                                        // Check if item has 'items' property (submenu)
                                        const hasSubmenu = 'items' in item;

                                        return (
                                            <div key={item.id} className="relative">
                                                <motion.button
                                                    onClick={() => {
                                                        if (hasSubmenu) {
                                                            setActiveMenu(isActive ? null : item.id);
                                                        } else {
                                                            handleToolClick(item.id);
                                                            setActiveMenu(null);
                                                        }
                                                    }}
                                                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                                                        isActive
                                                        ? "bg-slate-900 text-white shadow-md"
                                                        : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                                    }`}
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    title={item.label}
                                                >
                                                    <Icon className="h-5 w-5" weight={isActive ? "fill" : "regular"} />
                                                </motion.button>

                                                {/* Submenu Flyout */}
                                                <AnimatePresence>
                                                    {isActive && hasSubmenu && (
                                                        <motion.div
                                                            initial={{ opacity: 0, x: 10, scale: 0.95 }}
                                                            animate={{ opacity: 1, x: 20, scale: 1 }}
                                                            exit={{ opacity: 0, x: 10, scale: 0.95 }}
                                                            className="absolute left-full top-0 ml-4 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-xl backdrop-blur-xl min-w-[140px] z-50"
                                                        >
                                                            {/* Submenu Title */}
                                                            <div className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                                                                {item.label}
                                                            </div>
                                                            {(item as any).items.map((subItem: any) => {
                                                                const SubIcon = subItem.icon;
                                                                return (
                                                                    <motion.button
                                                                        key={subItem.id}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleToolClick(subItem.id);
                                                                            setActiveMenu(null);
                                                                        }}
                                                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors text-left"
                                                                        whileHover={{ x: 2 }}
                                                                    >
                                                                        <SubIcon className="h-4 w-4" />
                                                                        <span>{subItem.label}</span>
                                                                    </motion.button>
                                                                );
                                                            })}
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        );
                                    })}

                                    {/* Divider */}
                                    <div className="w-8 h-px bg-slate-200" />

                                    {/* Helper Tools (Undo/Redo/Layout) */}
                                    <motion.button
                                         onClick={onLayout}
                                         className="flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900"
                                         whileHover={{ scale: 1.05 }}
                                         whileTap={{ scale: 0.95 }}
                                         title="Auto Layout"
                                     >
                                         <MagicWand className="h-5 w-5" weight="regular" />
                                     </motion.button>

                                     <motion.button
                                         onClick={() => loroSync.undo()}
                                         disabled={!loroSync.canUndo}
                                         className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                                             loroSync.canUndo
                                             ? "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                             : "text-slate-300 cursor-not-allowed"
                                         }`}
                                         whileHover={loroSync.canUndo ? { scale: 1.05 } : {}}
                                         whileTap={loroSync.canUndo ? { scale: 0.95 } : {}}
                                         title="Undo"
                                     >
                                         <ArrowCounterClockwise className="h-5 w-5" weight="bold" />
                                     </motion.button>
                                     <motion.button
                                         onClick={() => loroSync.redo()}
                                         disabled={!loroSync.canRedo}
                                         className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                                             loroSync.canRedo
                                             ? "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                             : "text-slate-300 cursor-not-allowed"
                                         }`}
                                         whileHover={loroSync.canRedo ? { scale: 1.05 } : {}}
                                         whileTap={loroSync.canRedo ? { scale: 0.95 } : {}}
                                         title="Redo"
                                     >
                                         <ArrowClockwise className="h-5 w-5" weight="bold" />
                                     </motion.button>
                                 </div>
                            </div>

                            <div id="copilot-container" className="fixed right-0 top-0 bottom-0 z-40 pointer-events-none">
                                <div className="pointer-events-auto h-full">
                                    <ChatbotCopilot
                                        projectId={project.id}
                                        initialMessages={[]} // No persisted messages anymore
                                        onCommand={handleCommand}
                                        width={sidebarWidth}
                                        onWidthChange={setSidebarWidth}
                                        isCollapsed={isSidebarCollapsed}
                                        onCollapseChange={setIsSidebarCollapsed}
                                        selectedNodes={selectedNodes}
                                        onAddNode={addNode}
                                        onAddEdge={onConnect}
                                        onUpdateNode={updateNode}
                                        findNodeIdByName={findNodeIdByName}
                                        nodes={nodes}
                                        edges={edges}
                                        initialPrompt={initialPrompt}
                                    />
                                </div>
                            </div>
                        </div>
                        </div>
                        </LayoutActionsProvider>
                    </MediaViewerProvider>
                    </HideWhenEditorOpen>
                </VideoEditorProvider>
            </LoroSyncProvider>
        </ProjectProvider >
    );
}
