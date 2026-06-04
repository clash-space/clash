
import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
    ReactFlow,
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
    useViewport,
    SelectionMode,
} from '@xyflow/react';

// Use a flexible data type to preserve v11-style data access patterns throughout the codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppNode = Node<Record<string, any>>;
import '@xyflow/react/dist/style.css';
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
    PuzzlePiece,
    CursorClick,
    HandGrabbing,
} from '@phosphor-icons/react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Project } from '@clash/web-ui/lib/types';
// Old single-agent panel kept in the repo at './ChatbotCopilot' — reimport
// to revert. New chat UX is GroupChatPanel.
import { GroupChatPanel } from './GroupChatPanel';
import type { RoomMessageEvent } from '@clash/shared-types';
import { useSessionHistory } from '@clash/web-ui/hooks/useSessionHistory';
import { updateProjectName } from '@clash/web-ui/lib/clientActions';
import VideoNode from './nodes/VideoNode';
import ImageNode from './nodes/ImageNode';
import TextNode from './nodes/TextNode';
import AudioNode from './nodes/AudioNode';
import PromptActionNode from './nodes/ActionBadge'; // Renamed: ActionBadge -> PromptActionNode
import GroupNode from './nodes/GroupNode';
import VideoEditorNode from './nodes/VideoEditorNode';
import ImageEditorNode from './nodes/ImageEditorNode';
import VideoClipperNode from './nodes/VideoClipperNode';
import { MediaViewerProvider } from './MediaViewerContext';
import { ProjectProvider } from './ProjectContext';
import { VideoEditorProvider, useVideoEditor } from './VideoEditorContext';
import { ImageEditorProvider } from './ImageEditorContext';
import { VideoClipperProvider } from './VideoClipperContext';
import { getLayoutedElements } from '@clash/web-ui/lib/utils/elkLayout';
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
} from '@clash/web-ui/lib/layout';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { useLoroSync } from '@clash/web-ui/hooks/useLoroSync';
import { LoroSyncProvider } from './LoroSyncContext';
import type { PresenceClient } from '@clash/shared-types';
import PresenceBar from './PresenceBar';
import ActivityToast, { useActivityToasts } from './ActivityToast';
import NodeActivityIndicator, { useNodeHighlights } from './NodeActivityIndicator';
import AwarenessLayer from './AwarenessLayer';
import { PresenceAwarenessProvider } from './PresenceAwarenessContext';
import { usePresenceAwareness } from '@clash/web-ui/hooks/usePresenceAwareness';
import type { AwarenessBroadcastMessage } from '@clash/shared-types';
import { CascadeRunnerMount } from '@clash/web-ui/hooks/useCascadeRunner';
import { MODEL_CARDS } from '@clash/shared-types';
import { useCustomActions } from '@clash/web-ui/hooks/useCustomActions';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '@clash/web-ui/lib/loroNodeSync';
import { calculateScaledDimensions } from './nodes/assetNodeSizing';
import { getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import { DESKTOP_TAB_TITLE_EVENT, type DesktopTabTitleEventDetail } from '@clash/web-ui/lib/desktopTabs';
import { shouldDismissToolbarMenu, shouldDismissToolbarMenuOnKey } from './toolbarDismiss';

const CHILD_NODE_Z_INDEX_BASE = 1000;

interface ProjectEditorProps {
    project: Project;
    initialPrompt?: string;
    initialThreadId?: string;
    /** Globally installed actions from D1 (passed from server component) */
    globalActions?: Array<{
        actionId: string;
        name: string;
        description: string | null;
        runtime: string;
        version: string | null;
        author: string | null;
        workerUrl: string | null;
        icon: string | null;
        color: string | null;
        tags: string | null;
        manifest: string;
    }>;
}

/**
 * Keeps the project workspace mounted behind the video editor control layer.
 * The overlay owns interaction while the editor is open, but the canvas remains
 * visible as spatial context.
 */
function ProjectSurfaceBehindEditor({ children }: { children: React.ReactNode }) {
    const { isOpen } = useVideoEditor();
    return (
        <div
            aria-hidden={isOpen}
            style={{
                pointerEvents: isOpen ? 'none' : 'auto',
            }}
            className="h-screen w-full"
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
group: GroupNode,
    'video-editor': VideoEditorNode,
    'image-editor': ImageEditorNode,
    'video-clipper': VideoClipperNode,
};

const defaultImageModel = MODEL_CARDS.find((card) => card.kind === 'image');
const defaultVideoModel = MODEL_CARDS.find((card) => card.kind === 'video');
const defaultAudioModel = MODEL_CARDS.find((card) => card.kind === 'audio');
const defaultTextModel = MODEL_CARDS.find((card) => card.kind === 'text');

// ReactFlow v12: parent nodes must appear before children in the nodes array.
const sortNodesParentFirst = (nodes: AppNode[]): AppNode[] => {
    const idSet = new Set(nodes.map((n) => n.id));
    const result: AppNode[] = [];
    const visited = new Set<string>();
    const visit = (node: AppNode) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        if (node.parentId && idSet.has(node.parentId)) {
            const parent = nodes.find((n) => n.id === node.parentId);
            if (parent) visit(parent);
        }
        result.push(node);
    };
    for (const node of nodes) visit(node);
    return result;
};

const sanitizeNodes = (nodes: AppNode[]): AppNode[] => {
    const nodeIds = new Set(nodes.map(n => n.id));
    const cleaned = nodes.map(node => {
        if (node.parentId && !nodeIds.has(node.parentId)) {
            console.warn(`[Sanitize] Removing invalid parentId ${node.parentId} from node ${node.id}`);
            const { parentId: _, ...rest } = node;
            return { ...rest, parentId: undefined, extent: undefined };
        }
        return node;
    });
    return sortNodesParentFirst(cleaned);
};

/**
 * Floating "Group" pill that appears above the bounding box of the current
 * marquee/shift selection. Mounted inside <ReactFlow> so it can read the
 * viewport transform — position tracks pan/zoom, size stays in screen space.
 */
function SelectionGroupButton({
    bounds,
    onGroup,
}: {
    bounds: { absMinX: number; absMinY: number; absMaxX: number; absMaxY: number } | null;
    onGroup: () => void;
}) {
    const { x, y, zoom } = useViewport();
    if (!bounds) return null;

    const screenLeft = bounds.absMinX * zoom + x;
    const screenTop = bounds.absMinY * zoom + y;
    const screenWidth = (bounds.absMaxX - bounds.absMinX) * zoom;

    return (
        <div className="pointer-events-none absolute inset-0 overflow-visible" style={{ zIndex: 10000 }}>
            <motion.button
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    onGroup();
                }}
                className="pointer-events-auto absolute flex h-7 items-center gap-1.5 rounded-md border border-warm-border bg-white/90 px-2.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900"
                style={{
                    left: screenLeft + screenWidth / 2,
                    top: screenTop - 36,
                    transform: 'translateX(-50%)',
                }}
                title="Wrap selected nodes in a new Group"
            >
                <Square className="h-3.5 w-3.5" weight="regular" />
                Group
            </motion.button>
        </div>
    );
}

function DebugNodeIds({ nodes }: { nodes: AppNode[] }) {
    const { x, y, zoom } = useViewport();
    const [expandedNode, setExpandedNode] = useState<string | null>(null);

    // Build absolute positions by traversing parent chain
    const posById = useMemo(() => {
        const map = new Map<string, { x: number; y: number }>();
        const getAbs = (node: AppNode): { x: number; y: number } => {
            if (map.has(node.id)) return map.get(node.id)!;
            let { x: nx, y: ny } = node.position;
            if (node.parentId) {
                const parent = nodes.find(n => n.id === node.parentId);
                if (parent) { const p = getAbs(parent); nx += p.x; ny += p.y; }
            }
            const abs = { x: nx, y: ny };
            map.set(node.id, abs);
            return abs;
        };
        nodes.forEach(getAbs);
        return map;
    }, [nodes]);

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 9999 }}>
            <div style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
                {nodes.map(node => {
                    const d = node.data ?? {};
                    const parts = [node.id];
                    if (d.status) parts.push(d.status);
                    if (d.pendingTask) parts.push(`task:${d.pendingTask.slice(0, 8)}`);
                    if (d.src) parts.push('src:✓');
                    if (d.description) parts.push('desc:✓');
                    if (d.error) parts.push(`err:${d.error.slice(0, 20)}`);
                    if (d.modelId) parts.push(d.modelId);
                    if (d._log?.length) parts.push(`log:${d._log.length}`);
                    const isExpanded = expandedNode === node.id;
                    const abs = posById.get(node.id) ?? node.position;
                    return (
                        <div
                            key={`dbg-${node.id}`}
                            className="pointer-events-auto absolute cursor-pointer"
                            style={{
                                left: abs.x,
                                top: abs.y - 20,
                            }}
                            onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                        >
                            <span className="rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] text-green-400 whitespace-nowrap select-all">
                                {parts.join(' | ')}
                            </span>
                            {isExpanded && d._log?.length > 0 && (
                                <div className="mt-1 rounded bg-black/90 p-2 font-mono text-[10px] text-gray-300 max-w-[400px] max-h-[200px] overflow-auto">
                                    {d._log.map((entry: string, i: number) => (
                                        <div key={i} className={entry.includes('FAILED') ? 'text-red-400' : ''}>{entry}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function ProjectEditor({ project, initialPrompt, initialThreadId, globalActions = [] }: ProjectEditorProps) {
    // IMPORTANT: Start with empty canvas - Loro sync will populate from server
    // This ensures Loro is the single source of truth for nodes/edges
    // Legacy: project.nodes/edges from DB are now ignored
    const initialNodes: AppNode[] = [];
    const initialEdges: Edge[] = [];

    const [nodes, setNodesInternal] = useNodesState<AppNode>(initialNodes);
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
    const toolbarRef = useRef<HTMLDivElement>(null);
    const toolbarFlyoutRef = useRef<HTMLDivElement>(null);
    const [activeMenuPosition, setActiveMenuPosition] = useState({ top: 0, left: 0 });
    const [projectName, setProjectName] = useState(project.name);
    const location = useLocation();
    const [showDebugIds, setShowDebugIds] = useState(false);
    const [canvasMode, setCanvasMode] = useState<'select' | 'hand'>('select');

    useEffect(() => {
        const detail: DesktopTabTitleEventDetail = {
            path: location.pathname,
            title: projectName || project.name || 'Untitled',
        };
        window.dispatchEvent(new CustomEvent(DESKTOP_TAB_TITLE_EVENT, { detail }));
    }, [location.pathname, project.name, projectName]);

    useEffect(() => {
        if (!activeMenu) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (shouldDismissToolbarMenu({ activeMenu, toolbarRoot: toolbarRef.current, flyoutRoot: toolbarFlyoutRef.current, target: event.target })) {
                setActiveMenu(null);
            }
        };
        const handleFocusIn = (event: FocusEvent) => {
            if (shouldDismissToolbarMenu({ activeMenu, toolbarRoot: toolbarRef.current, flyoutRoot: toolbarFlyoutRef.current, target: event.target })) {
                setActiveMenu(null);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (shouldDismissToolbarMenuOnKey(activeMenu, event.key)) {
                setActiveMenu(null);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeMenu]);

    // Collaboration visibility: presence + activity
    const [presenceClients, setPresenceClients] = useState<PresenceClient[]>([]);
    // Filter out the current user from presence (you don't need to see yourself)
    const otherClients = presenceClients.filter((c) => c.userId !== project.ownerId);
    const { toasts, addToast, dismiss: dismissToast } = useActivityToasts();
    const { highlights, addHighlight } = useNodeHighlights();

    // GroupChatPanel registers a sink for room.message frames so the
    // single useLoroSync WS can fan room IM out to the new chat UI
    // without opening a second connection.
    const roomSinkRef = useRef<((msg: RoomMessageEvent) => void) | null>(null);
    const registerRoomSink = useCallback((sink: (msg: RoomMessageEvent) => void) => {
        roomSinkRef.current = sink;
    }, []);

    // Awareness: live cursor + selection over the same WS.
    // The handler ref is set by usePresenceAwareness below; useLoroSync
    // forwards every `awareness.broadcast` frame into it.
    const awarenessSinkRef = useRef<((msg: AwarenessBroadcastMessage) => void) | null>(null);
    const registerOnAwareness = useCallback(
        (handler: ((msg: AwarenessBroadcastMessage) => void) | null) => {
            awarenessSinkRef.current = handler;
        },
        [],
    );

    // Loro CRDT sync
    const loroSync = useLoroSync({
        projectId: project.id,
        onPresenceChange: setPresenceClients,
        onActivity: (activity) => {
            addToast(activity);
            addHighlight(activity);
        },
        onRoomMessage: (msg) => {
            roomSinkRef.current?.(msg);
        },
        onAwareness: (msg) => {
            awarenessSinkRef.current?.(msg);
        },
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

                    // Fix: Ensure action-badge nodes don't persist oversized dimensions
                    if (syncedNode.type === 'action-badge') {
                        const storedWidth = syncedNode.width || syncedNode.style?.width;
                        const storedHeight = syncedNode.height || syncedNode.style?.height;
                        if ((storedWidth && Number(storedWidth) > 280) || (storedHeight && Number(storedHeight) > 80)) {
                            correctedNode = {
                                ...correctedNode,
                                width: undefined,
                                height: undefined,
                                style: {
                                    ...correctedNode.style,
                                    width: undefined,
                                    height: undefined,
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
                        if (!loroSyncRef.current) return;

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

    // Awareness: cursor + selection. Rides on loroSync's WS via sendSideband.
    // sendSideband doesn't change identity once loroSync is created, so we
    // pass it directly without ref'ing.
    const awareness = usePresenceAwareness({
        registerOnAwareness,
        sendSideband: loroSync.sendSideband,
    });



    // File upload state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasModeBeforeSpace = useRef<'select' | 'hand'>('select');
    const [pendingNodeType, setPendingNodeType] = useState<string | null>(null);

    // Sidebar state
    // Sidebar state starts with server defaults; localStorage is read post-mount to avoid hydration mismatch.
    const [sidebarWidth, setSidebarWidth] = useState(384);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [sidebarHydrated, setSidebarHydrated] = useState(false);

    useEffect(() => {
        const savedWidth = localStorage.getItem('copilot-sidebar-width');
        if (savedWidth) setSidebarWidth(parseInt(savedWidth, 10));
        setIsSidebarCollapsed(localStorage.getItem('copilot-sidebar-collapsed') === 'true');
        setSidebarHydrated(true);
    }, []);

    useEffect(() => {
        if (sidebarHydrated) localStorage.setItem('copilot-sidebar-width', String(sidebarWidth));
    }, [sidebarWidth, sidebarHydrated]);
    useEffect(() => {
        if (sidebarHydrated) localStorage.setItem('copilot-sidebar-collapsed', String(isSidebarCollapsed));
    }, [isSidebarCollapsed, sidebarHydrated]);

    // Chat session state
    const [threadId, setThreadId] = useState<string>(initialThreadId || '');
    const [sessionKey, setSessionKey] = useState(0);
    const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(initialPrompt);
    const editorRouter = useNavigate();
    const { sessions: sessionHistory, upsertSession, deleteSession: removeSession } = useSessionHistory(project.id);

    const handleCreateSession = useCallback(async (initialMessage?: string): Promise<{ threadId: string; title: string } | null> => {
        try {
            const title = initialMessage
                ? initialMessage.slice(0, 40).trim() + (initialMessage.length > 40 ? '...' : '')
                : `Session`;
            const res = await fetch(runtimeApiUrl('/api/v1/sessions'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, title }),
            });
            if (!res.ok) throw new Error('Failed to create session');
            const data = (await res.json()) as { threadId: string };
            // Don't update any state here — caller batches all state updates together
            return { threadId: data.threadId as string, title };
        } catch (err) {
            console.error('Failed to create session:', err);
            return null;
        }
    }, [project.id]);

    const handleNewSession = useCallback(() => {
        setChatInitialPrompt(undefined);
        setThreadId('');
        setSessionKey(k => k + 1);
    }, []);

    const handleSwitchSession = useCallback((id: string) => {
        setChatInitialPrompt(undefined);
        setThreadId(id);
    }, []);

    const handleDeleteSession = useCallback((id: string) => {
        removeSession(id);
        if (id === threadId) setThreadId('');
    }, [removeSession, threadId]);

    // Auto-create session for initialPrompt from HomePage. The initial prompt
    // rides along on chatInitialPrompt → ChatbotCopilot's mount-time
    // queueMessageOnOpen. The threadId-keyed remount makes the new mount
    // pick it up cleanly.
    const hasCreatedSessionRef = useRef(false);
    useEffect(() => {
        if (initialPrompt && !threadId && !hasCreatedSessionRef.current) {
            hasCreatedSessionRef.current = true;
            handleCreateSession(initialPrompt).then(result => {
                if (result) {
                    upsertSession(result.threadId, result.title);
                    setChatInitialPrompt(initialPrompt!);
                    setThreadId(result.threadId);
                }
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount

	    // Selection state
	    const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
	    // True while the user is actively dragging the marquee. We hide the
	    // "Group" pill until release — otherwise it flickers in mid-drag as the
	    // selection rectangle grows past 2 nodes.
	    const [isMarqueeing, setIsMarqueeing] = useState(false);

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
	            let updatedNodes = applyNodeChanges(changes as NodeChange<AppNode>[], currentNodes);

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
        if (removeChanges.length > 0) {
            removeChanges.forEach(change => {
                if (change.type === 'remove') {
                    loroSync.removeNode(change.id);
                }
            });
        }

    }, [setNodes, loroSync, applyAutoZIndex]);

    // GC-style protection: a canvas asset that's been "consumed" by a frozen
    // (already-run) ActionBadge can't be silently yanked out from under it.
    // Block both the upstream node and the edge feeding the action — once the
    // generation has gone out, the lineage is locked.
    const onBeforeDelete = useCallback(async ({ nodes: nds, edges: eds }: { nodes: Node[]; edges: Edge[] }) => {
        const frozenActionIds = new Set<string>();
        for (const n of nodes) {
            if (n.type === 'action-badge' && (n.data as Record<string, unknown>)?.hasRun) {
                frozenActionIds.add(n.id);
            }
        }
        if (frozenActionIds.size === 0) return { nodes: nds, edges: eds };

        const lockedEdgeIds = new Set<string>();
        const pinnedNodeIds = new Set<string>();
        for (const e of edges) {
            if (frozenActionIds.has(e.target)) {
                lockedEdgeIds.add(e.id);
                pinnedNodeIds.add(e.source);
            }
        }

        const allowedNodes = nds.filter(n => !pinnedNodeIds.has(n.id));
        const allowedEdges = eds.filter(e => !lockedEdgeIds.has(e.id));
        return { nodes: allowedNodes, edges: allowedEdges };
    }, [nodes, edges]);

    // Reliable sync handlers
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        deletedNodes.forEach(node => {
            loroSync.removeNode(node.id);
        });

        // Drop project's asset_refs row for any assetId no longer referenced by any surviving node.
        // Other projects sharing the same asset are unaffected (M:N).
        const deletedIds = new Set(deletedNodes.map(n => n.id));
        const survivingAssetIds = new Set(
            nodes
                .filter(n => !deletedIds.has(n.id))
                .map(n => (n.data as Record<string, unknown>)?.assetId as string | undefined)
                .filter((v): v is string => !!v),
        );
        const orphanedAssetIds = new Set(
            deletedNodes
                .map(n => (n.data as Record<string, unknown>)?.assetId as string | undefined)
                .filter((v): v is string => !!v && !survivingAssetIds.has(v)),
        );
        orphanedAssetIds.forEach(assetId => {
            void fetch(runtimeApiUrl(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(project.id)}`), {
                method: 'DELETE',
            }).catch(e => console.warn('[onNodesDelete] removeAssetRef failed', assetId, e));
        });
    }, [loroSync, nodes, project.id]);

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
	                    extent: nextNode.extent,
	                    style: nextNode.style,
	                };

	                patchesToSync = collectLayoutNodePatches(nds, updatedNodes).filter((p) => p.id !== draggedNode.id);
	                return updatedNodes;
	            });
	        });

	        if (draggedNodePatch) {
	            loroSync.updateNode(node.id, draggedNodePatch);
	        }
	        applyLayoutPatchesToLoro(loroSync, patchesToSync);
	    }, [setNodes, loroSync, applyAutoZIndex]);

    const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
        setSelectedNodes(nodes);
        // Broadcast selection to peers via the awareness sideband. Throttled
        // inside the hook, so frequent selection-rectangle drags don't flood.
        awareness.setLocalSelection(nodes.map((n) => n.id));
    }, [awareness]);

    // Show a "Group" pill when 2+ siblings are selected. We collapse selected
    // descendants into their selected ancestor (otherwise we'd nest a node and
    // its own parent), and require everything left to share a parent so the
    // new Group can sit at one well-defined level in the hierarchy.
    const selectionBounds = useMemo(() => {
        if (isMarqueeing) return null;
        if (selectedNodes.length < 2) return null;
        // Suppress while a node is being moved — bounds would lag behind the
        // drag and the pill would float over moving content.
        if (selectedNodes.some((n) => n.dragging)) return null;

        const selectedIds = new Set(selectedNodes.map((n) => n.id));
        const nodesById = new Map(nodes.map((n) => [n.id, n]));
        const topLevel = selectedNodes.filter((n) => {
            let pid = (nodesById.get(n.id) ?? n).parentId;
            while (pid) {
                if (selectedIds.has(pid)) return false;
                pid = nodesById.get(pid)?.parentId;
            }
            return true;
        });
        if (topLevel.length < 2) return null;

        const commonParent = (nodesById.get(topLevel[0].id) ?? topLevel[0]).parentId;
        if (!topLevel.every((n) => ((nodesById.get(n.id) ?? n).parentId) === commonParent)) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const sel of topLevel) {
            const node = nodesById.get(sel.id) ?? sel;
            const rect = getAbsoluteRect(node, nodes);
            if (rect.x < minX) minX = rect.x;
            if (rect.y < minY) minY = rect.y;
            if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
            if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
        }
        if (!Number.isFinite(minX)) return null;

        return {
            absMinX: minX,
            absMinY: minY,
            absMaxX: maxX,
            absMaxY: maxY,
            topLevelIds: topLevel.map((n) => n.id),
            parentId: commonParent,
        };
    }, [isMarqueeing, selectedNodes, nodes]);

    const groupSelectedNodes = useCallback(() => {
        if (!selectionBounds) return;
        const { absMinX, absMinY, absMaxX, absMaxY, topLevelIds, parentId: commonParentId } = selectionBounds;
        const PADDING = 40;
        const TITLE_GAP = 32; // space above for the floating group title input

        const groupAbsX = absMinX - PADDING;
        const groupAbsY = absMinY - TITLE_GAP - PADDING;
        const groupWidth = (absMaxX - absMinX) + PADDING * 2;
        const groupHeight = (absMaxY - absMinY) + TITLE_GAP + PADDING * 2;

        // Convert the group's absolute position into the common parent's local space.
        let groupX = groupAbsX;
        let groupY = groupAbsY;
        if (commonParentId) {
            const parent = nodes.find((n) => n.id === commonParentId);
            if (parent) {
                const parentAbs = getAbsolutePosition(parent, nodes);
                groupX = groupAbsX - parentAbs.x;
                groupY = groupAbsY - parentAbs.y;
            }
        }

        // z-index: mirror the addNode('group', ...) branch so collision/depth
        // assumptions elsewhere keep holding.
        let zIndex: number | undefined;
        if (commonParentId) {
            const parent = nodes.find((n) => n.id === commonParentId);
            const parentZIndex = Number(parent?.style?.zIndex ?? 0);
            zIndex = parentZIndex + 1;
        } else {
            const groupNodes = nodes.filter((n) => n.type === 'group');
            const minZIndex = groupNodes.reduce((min, n) => Math.min(min, Number(n.style?.zIndex ?? 0)), 0);
            zIndex = minZIndex - 1;
        }

        const groupId = `group-${Date.now()}`;
        const newGroup: Node = {
            id: groupId,
            type: 'group',
            position: { x: groupX, y: groupY },
            data: { label: 'Group' },
            parentId: commonParentId,
            width: groupWidth,
            height: groupHeight,
            style: { width: groupWidth, height: groupHeight, zIndex },
            className: 'group-node',
            extent: undefined,
        };

        const selectedSet = new Set(topLevelIds);
        const childUpdates: Array<{ id: string; parentId: string; position: { x: number; y: number } }> = [];

        setNodes((nds) => {
            const absPos = new Map<string, { x: number; y: number }>();
            for (const id of selectedSet) {
                const n = nds.find((node) => node.id === id);
                if (n) absPos.set(id, getAbsolutePosition(n, nds));
            }

            let updated = [...nds, newGroup];
            updated = updated.map((n) => {
                if (!selectedSet.has(n.id)) return n;
                const abs = absPos.get(n.id);
                if (!abs) return n;
                const nextPos = { x: abs.x - groupAbsX, y: abs.y - groupAbsY };
                childUpdates.push({ id: n.id, parentId: groupId, position: nextPos });
                return {
                    ...n,
                    parentId: groupId,
                    position: nextPos,
                    extent: undefined,
                    selected: false,
                };
            });
            updated = applyAutoZIndex(updated);
            return updated;
        });

        loroSync.addNode(groupId, newGroup);
        for (const upd of childUpdates) {
            loroSync.updateNode(upd.id, { parentId: upd.parentId, position: upd.position });
        }

        // Clear local selection so the pill disappears after grouping.
        setSelectedNodes([]);
        awareness.setLocalSelection([]);
    }, [selectionBounds, nodes, setNodes, loroSync, applyAutoZIndex, awareness]);

    // Auto-save logic removed: Loro is the single source of truth.

    // Suppress browser-level zoom (Cmd/Ctrl + wheel, trackpad pinch, Safari
    // gesture events) for events that fire OUTSIDE the React Flow pane. RF
    // owns wheel/pinch inside the canvas — we don't touch those — but elsewhere
    // accidental zoom rescales the whole page and the canvas content "vanishes"
    // off-screen. preventDefault on the bubble phase suppresses the browser
    // gesture without interfering with RF's own zoom handler.
    useEffect(() => {
        const isInsideCanvas = (target: EventTarget | null): boolean => {
            return target instanceof Element && !!target.closest('.react-flow');
        };
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (isInsideCanvas(e.target)) return;
            e.preventDefault();
        };
        const onGesture = (e: Event) => {
            if (isInsideCanvas(e.target)) return;
            e.preventDefault();
        };
        const onKeyZoom = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (e.key === '+' || e.key === '-' || e.key === '=') {
                e.preventDefault();
            }
        };
        window.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('gesturestart', onGesture as EventListener, { passive: false });
        window.addEventListener('gesturechange', onGesture as EventListener, { passive: false });
        window.addEventListener('gestureend', onGesture as EventListener, { passive: false });
        window.addEventListener('keydown', onKeyZoom);
        return () => {
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('gesturestart', onGesture as EventListener);
            window.removeEventListener('gesturechange', onGesture as EventListener);
            window.removeEventListener('gestureend', onGesture as EventListener);
            window.removeEventListener('keydown', onKeyZoom);
        };
    }, []);


    // Custom handleEdgesChange to sync edge deletions to Loro
    const handleEdgesChange = useCallback((changes: import('@xyflow/react').EdgeChange[]) => {
        onEdgesChange(changes);

        // Handle edge deletions - sync to Loro
        const removeChanges = changes.filter(c => c.type === 'remove');
        if (removeChanges.length > 0) {
            removeChanges.forEach(change => {
                if (change.type === 'remove') {
                    loroSync.removeEdge(change.id);
                }
            });
        }
    }, [onEdgesChange, loroSync]);

    const onConnect = useCallback(
        (params: Connection | Edge) => {
            // Reject invalid connections (e.g. video → image-gen ActionBadge can't use video as reference image)
            const srcId = (params as Connection).source;
            const tgtId = (params as Connection).target;
            if (srcId && tgtId) {
                const src = nodes.find(n => n.id === srcId);
                const tgt = nodes.find(n => n.id === tgtId);
                // GC-style protection: a frozen action-badge has already shipped
                // its generation — its refs are part of that lineage and can't
                // be extended after the fact.
                if (tgt?.type === 'action-badge' && (tgt.data as Record<string, unknown>)?.hasRun) {
                    console.warn(`[onConnect] rejected: target action-badge is frozen (already run)`);
                    return;
                }
                const tgtIsImageGen = tgt?.type === 'action-badge' && (tgt.data as any)?.actionType === 'image-gen';
                if (tgtIsImageGen && (src?.type === 'video' || src?.type === 'audio')) {
                    console.warn(`[onConnect] rejected: ${src?.type} cannot feed an image-gen node`);
                    return;
                }
            }
            // Canonical edgeId — same shape ActionBadge.addRefNode uses.
            // Without this, drag-connect and @-mention auto-connect produce
            // two parallel edges (different ids, same source/target) and
            // the badge surfaces the same ref twice.
            const canonicalId = `${(params as Connection).source}-${(params as Connection).target}`;
            const paramsWithDefaults = {
                ...params,
                id: canonicalId,
                interactionWidth: 30,
                focusable: true,
                selectable: true,
                deletable: true,
            };
            setEdges((eds) => {
                if (eds.some(e => e.id === canonicalId)) return eds;
                const newEdges = addEdge(paramsWithDefaults as any, eds);
                const addedEdge = newEdges.find(e => e.id === canonicalId);
                if (addedEdge) loroSync.addEdge(addedEdge.id, addedEdge);
                return newEdges;
            });
        },
        [nodes, setEdges, loroSync]
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

            // Ctrl/Cmd+Shift+D: toggle debug node IDs (dev only)
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D' && process.env.NODE_ENV === 'development') {
                e.preventDefault();
                setShowDebugIds(v => !v);
            }

            // Del/Backspace: delete selected edges (ReactFlow's deleteKeyCode isn't firing reliably).
            // Honor the same freeze guard as `onBeforeDelete` — edges into a frozen
            // ActionBadge are part of a shipped lineage and can't be detached.
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const frozenActionIds = new Set(
                    nodes
                        .filter(n => n.type === 'action-badge' && (n.data as Record<string, unknown>)?.hasRun)
                        .map(n => n.id),
                );
                const selectedEdgeIds = edges
                    .filter(ed => ed.selected && !frozenActionIds.has(ed.target))
                    .map(ed => ed.id);
                if (selectedEdgeIds.length > 0) {
                    e.preventDefault();
                    setEdges(eds => eds.filter(ed => !selectedEdgeIds.includes(ed.id)));
                    selectedEdgeIds.forEach(eid => loroSync.removeEdge(eid));
                }
            }

            // V: select mode, H: hand mode (Figma-style)
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                if (e.key === 'v') setCanvasMode('select');
                if (e.key === 'h') setCanvasMode('hand');
            }

            // Space: temporary hand mode
            if (e.key === ' ' && !e.repeat) {
                e.preventDefault();
                setCanvasMode(prev => {
                    canvasModeBeforeSpace.current = prev;
                    return 'hand';
                });
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === ' ') {
                setCanvasMode(canvasModeBeforeSpace.current);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [loroSync, edges, setEdges]);

    // Merge local (Loro) + global (D1) custom actions, deduplicate by ID
    const loroActions = useCustomActions(loroSync.doc);
    const customActions = useMemo(() => {
        const merged = new Map<string, typeof loroActions[number]>();
        // Global actions first (from D1)
        for (const ga of globalActions) {
            try {
                const manifest = JSON.parse(ga.manifest);
                merged.set(ga.actionId, {
                    id: ga.actionId,
                    name: ga.name,
                    description: ga.description || undefined,
                    parameters: manifest.parameters || [],
                    outputType: manifest.outputType || 'image',
                    icon: ga.icon || undefined,
                    color: ga.color || undefined,
                    runtime: (ga.runtime as 'local' | 'worker') || 'worker',
                    version: ga.version || undefined,
                    author: ga.author || undefined,
                    workerUrl: ga.workerUrl || undefined,
                    promptModalities: manifest.promptModalities || ['text'],
                });
            } catch { /* skip invalid manifest */ }
        }
        // Loro actions override (local registrations take precedence)
        for (const la of loroActions) {
            merged.set(la.id, la);
        }
        return Array.from(merged.values());
    }, [loroActions, globalActions]);

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
                { id: 'action-badge-audio', label: 'Audio Gen', icon: SpeakerHigh },
                { id: 'action-badge-text', label: 'Text Gen', icon: TextT },
                ...customActions.map((a) => ({
                    id: `action-badge-custom-${a.id}`,
                    label: `${a.runtime === 'worker' ? '☁️ ' : ''}${a.name}`,
                    icon: PuzzlePiece,
                })),
            ]
        },
        { id: 'video-editor', label: 'Editor', icon: FilmSlate },
        { id: 'group', label: 'Group', icon: Square },
        { id: 'text', label: 'Text', icon: TextT },
    ];
    const activeToolbarMenu = toolbarMenu.find((item) => item.id === activeMenu && 'items' in item) as
        | { id: string; label: string; items: Array<{ id: string; label: string; icon: React.ComponentType<any> }> }
        | undefined;

    const addNode = useCallback((type: string, extraData: any = {}) => {
        let nodeType = type;
        let nodeData: any = { label: `New ${type}`, ...extraData };
        const imageModelDefaults = {
            modelId: defaultImageModel?.id ?? 'nano-banana-2',
            model: defaultImageModel?.id ?? 'nano-banana-2',
            modelParams: { ...(defaultImageModel?.defaultParams ?? {}) },
        };
        const videoModelDefaults = {
            modelId: defaultVideoModel?.id ?? 'sora-2',
            model: defaultVideoModel?.id ?? 'sora-2',
            modelParams: { ...(defaultVideoModel?.defaultParams ?? {}) },
        };
        const audioModelDefaults = {
            modelId: defaultAudioModel?.id ?? 'gemini-3.1-flash-tts',
            model: defaultAudioModel?.id ?? 'gemini-3.1-flash-tts',
            modelParams: { ...(defaultAudioModel?.defaultParams ?? {}) },
        };
        const textModelDefaults = {
            modelId: defaultTextModel?.id ?? 'gpt-5.4',
            model: defaultTextModel?.id ?? 'gpt-5.4',
            modelParams: { ...(defaultTextModel?.defaultParams ?? {}) },
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
        } else if (type === 'action-badge-audio' || type === 'audio-gen') {
            nodeType = 'action-badge';
            nodeData = {
                label: 'Audio Prompt',
                actionType: 'audio-gen',
                ...audioModelDefaults,
                content: '# Prompt\nEnter your prompt here...',
                ...nodeData
            };
        } else if (type === 'action-badge-text' || type === 'text-gen') {
            nodeType = 'action-badge';
            nodeData = {
                label: 'Text Prompt',
                actionType: 'text-gen',
                ...textModelDefaults,
                content: '# Prompt\nEnter your prompt here...',
                ...nodeData
            };
        } else if (type.startsWith('action-badge-custom-')) {
            const customId = type.replace('action-badge-custom-', '');
            const def = customActions.find((a) => a.id === customId);
            nodeType = 'action-badge';
            nodeData = {
                label: def?.name || 'Custom Action',
                actionType: `custom:${customId}`,
                customActionId: customId,
                customActionParams: {},
                content: '# Prompt\nEnter your prompt here...',
                ...nodeData,
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
                defaultWidth = 260;
                defaultHeight = 48;
                layoutWidth = 260;
                layoutHeight = 48;
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

            // If no parentId, place below all existing root nodes
            if (!parentId && nds.length > 0) {
                let maxBottom = 0;
                let leftmostX = Infinity;

                nds.forEach(n => {
                    if (!n.parentId) {
                        const h = n.height || Number(n.style?.height) || 300;
                        const bottom = n.position.y + h;
                        if (bottom > maxBottom) maxBottom = bottom;
                        leftmostX = Math.min(leftmostX, n.position.x);
                    }
                });

                if (maxBottom > 0) {
                    targetPos = {
                        x: Number.isFinite(leftmostX) ? leftmostX : 100,
                        y: maxBottom + 50,
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
                    // Place new group below existing groups
                    const existingGroups = nds.filter(n => n.type === 'group');
                    if (existingGroups.length > 0) {
                        let maxBottom = 0;
                        let leftmostX = Infinity;
                        for (const g of existingGroups) {
                            const h = g.height || Number(g.style?.height) || 400;
                            maxBottom = Math.max(maxBottom, g.position.y + h);
                            leftmostX = Math.min(leftmostX, g.position.x);
                        }
                        targetPos = {
                            x: Number.isFinite(leftmostX) ? leftmostX : 100,
                            y: maxBottom + 100,
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
                    // Shift down to avoid overlap
                    position = { x: targetPos.x, y: targetPos.y + layoutHeight + 50 };
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
            if (createdNode) {
                loroSync.addNode(newNodeId, createdNode);
            }

            return finalNodes;
        });
        return newNodeId;
    }, [nodes, selectedNodes, setNodes, loroSync, applyAutoZIndex, customActions]);

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

            loroSync.addEdge(edgeId, newEdge);

            return [...eds, newEdge];
        });
    }, [setEdges, loroSync]);

    const uploadFileAsAssetNode = useCallback(
        async (
            file: File,
            assetType: 'image' | 'video' | 'audio',
            options?: { connectToVideoEditorId?: string }
        ): Promise<{
            id: string;
            type: 'image' | 'video' | 'audio';
            assetId?: string;
            sourceNodeId?: string;
            backingAssetId?: string;
            src: string;
            name: string;
            width?: number;
            height?: number;
            duration?: number;
        } | null> => {
            const placeholderId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const localPreviewUrl = URL.createObjectURL(file);

            // HTML probe purely to size the placeholder node. Result goes
            // straight into node.width/height (measuredSize) — no need for
            // a parallel set of data.preview* fields. The server re-probes
            // authoritatively after upload and the reconciliation effect in
            // ImageNode/VideoNode repairs any drift.
            let probedW: number | undefined;
            let probedH: number | undefined;
            if (file.type.startsWith('image/')) {
                try {
                    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                        img.onerror = reject;
                        img.src = localPreviewUrl;
                    });
                    probedW = dims.width;
                    probedH = dims.height;
                } catch (err) {
                    console.warn('[Upload] image preview probe failed', err);
                }
            } else if (file.type.startsWith('video/')) {
                try {
                    const info = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                        const video = document.createElement('video');
                        video.preload = 'metadata';
                        video.onloadedmetadata = () => resolve({
                            width: video.videoWidth,
                            height: video.videoHeight,
                        });
                        video.onerror = () => reject(new Error('Failed to read video metadata'));
                        video.src = localPreviewUrl;
                    });
                    probedW = info.width;
                    probedH = info.height;
                } catch (err) {
                    console.warn('[Upload] video preview probe failed', err);
                }
            }

            addNode(assetType, {
                id: placeholderId,
                label: file.name,
                status: 'uploading',
                previewUrl: localPreviewUrl, // transient blob URL (revoke on completion)
                createdAt: Date.now(),
            });

            // Seed the node's measuredSize with the probed dimensions so the
            // placeholder renders at the correct aspect ratio immediately.
            if (probedW && probedH) {
                const scaled = calculateScaledDimensions(probedW, probedH);
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === placeholderId
                            ? { ...n, width: scaled.width, height: scaled.height, style: { ...n.style, width: scaled.width, height: scaled.height } }
                            : n
                    )
                );
                if (loroSync.connected) {
                    loroSync.updateNode(placeholderId, { width: scaled.width, height: scaled.height });
                }
            }

            if (options?.connectToVideoEditorId) {
                addAssetEdgeToEditor(placeholderId, options.connectToVideoEditorId);
            }

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('projectId', project.id);
                formData.append('type', assetType);

                const res = await fetch(runtimeApiUrl('/upload'), {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(errorText || 'Failed to upload to R2');
                }

                const { storageKey } = (await res.json()) as { storageKey: string };

                // Register the asset in D1. Server probes width/height/
                // durationMs/waveform/bytes itself from the R2 object — we
                // only hand it the reference + kind.
                let assetId: string | undefined;
                try {
                    const regRes = await fetch(runtimeApiUrl('/api/v1/assets'), {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            projectId: project.id,
                            kind: assetType,
                            srcR2Key: storageKey,
                        }),
                    });
                    if (regRes.ok) {
                        ({ id: assetId } = (await regRes.json()) as { id: string });
                    } else {
                        console.warn('[Upload] asset registration failed', regRes.status, await regRes.text());
                    }
                } catch (e) {
                    console.warn('[Upload] asset registration threw', e);
                }

                // Node data gets `assetId` + `status=completed`. Preview
                // fields stay in place on purpose: there's a short window
                // between the status flip and `useAsset(assetId)` actually
                // resolving the asset row — clearing preview*/previewUrl
                // here would make the node render "No Image" for that
                // window. Node components are responsible for preferring
                // asset.* once it lands. The blob URL stays alive until
                // the tab closes; a few MB of preview blobs per session
                // is cheap insurance against the flash.
                const completedPatch = {
                    ...(assetId ? { assetId } : {}),
                    status: 'completed' as const,
                };
                setNodes((nds) =>
                    nds.map((node) =>
                        node.id === placeholderId
                            ? { ...node, data: { ...node.data, ...completedPatch } }
                            : node
                    )
                );
                loroSync.updateNode(placeholderId, { data: completedPatch });

                // Resolve the asset row for the VideoEditor's internal Asset
                // shape (it wants a signed src / dimensions / duration).
                // Uses the same cached getAsset() / getSignedUrl() path that
                // VideoEditorNode.handleOpenEditor uses — no extra round-trip
                // beyond the one we'd need anyway to display the media.
                let resolvedSrc = '';
                let width: number | undefined;
                let height: number | undefined;
                let duration: number | undefined;
                if (assetId) {
                    try {
                        const asset = await getAsset(assetId);
                        resolvedSrc = await getSignedUrl(asset.srcR2Key);
                        width = asset.metadata?.width;
                        height = asset.metadata?.height;
                        duration = asset.metadata?.durationMs != null
                            ? asset.metadata.durationMs / 1000
                            : undefined;
                    } catch (e) {
                        console.warn('[Upload] post-upload asset resolve failed', e);
                    }
                }
                return {
                    id: placeholderId,
                    type: assetType,
                    assetId,
                    sourceNodeId: placeholderId,
                    backingAssetId: assetId,
                    src: resolvedSrc,
                    name: file.name,
                    width,
                    height,
                    duration,
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
                loroSync.updateNode(placeholderId, {
                    data: { status: 'failed' },
                });
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
                    data = { actionType: 'image-gen', modelId: defaultImageModel?.id ?? 'nano-banana-2', model: defaultImageModel?.id ?? 'nano-banana-2', modelParams: { ...(defaultImageModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 80;
                } else if (type === 'video-gen') {
                    type = 'action-badge';
                    data = { actionType: 'video-gen', modelId: defaultVideoModel?.id ?? 'sora-2', model: defaultVideoModel?.id ?? 'sora-2', modelParams: { ...(defaultVideoModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 80;
                } else if (type === 'audio-gen') {
                    type = 'action-badge';
                    data = { actionType: 'audio-gen', modelId: defaultAudioModel?.id ?? 'gemini-3.1-flash-tts', model: defaultAudioModel?.id ?? 'gemini-3.1-flash-tts', modelParams: { ...(defaultAudioModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 80;
                } else if (type === 'text-gen') {
                    type = 'action-badge';
                    data = { actionType: 'text-gen', modelId: defaultTextModel?.id ?? 'gpt-5.4', model: defaultTextModel?.id ?? 'gpt-5.4', modelParams: { ...(defaultTextModel?.defaultParams ?? {}) }, ...data };
                    if (!rest.width) rest.width = 200;
                    if (!rest.height) rest.height = 80;
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
        []
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

    // Inverse of groupSelectedNodes: promote each direct child of the group to
    // the group's own parent (preserving absolute position), then delete the
    // group. Nested groups bubble up one level — they stay groups.
    const ungroup = useCallback((groupId: string) => {
        const group = nodes.find((n) => n.id === groupId);
        if (!group || group.type !== 'group') return;

        const newParentId = group.parentId;
        const directChildren = nodes.filter((n) => n.parentId === groupId);

        const childUpdates = directChildren.map((c) => ({
            id: c.id,
            parentId: newParentId,
            position: {
                x: group.position.x + c.position.x,
                y: group.position.y + c.position.y,
            },
        }));

        setNodes((nds) => {
            let updated = nds.map((n) => {
                const upd = childUpdates.find((u) => u.id === n.id);
                if (!upd) return n;
                return { ...n, parentId: newParentId, position: upd.position, extent: undefined };
            });
            updated = updated.filter((n) => n.id !== groupId);
            updated = applyAutoZIndex(updated);
            return updated;
        });

        for (const upd of childUpdates) {
            loroSync.updateNode(upd.id, { parentId: upd.parentId, position: upd.position });
        }
        loroSync.removeNode(groupId);
    }, [nodes, setNodes, loroSync, applyAutoZIndex]);


    const findNodeIdByName = useCallback((name: string): string | undefined => {
        const node = nodes.find(n => n.data?.label === name);
        return node?.id;
    }, [nodes]);


    return (
        <ProjectProvider projectId={project.id}>
            <LoroSyncProvider loroSync={loroSync}>
              <PresenceAwarenessProvider peers={awareness.peers}>
              <ImageEditorProvider>
                <VideoClipperProvider>
                <VideoEditorProvider
                    onAssetAddedToCanvas={handleEditorAssetAdded}
                    onCanvasAssetLinked={(asset, editorNodeId) => {
                        if (!asset.sourceNodeId) return;
                        addAssetEdgeToEditor(asset.sourceNodeId, editorNodeId);
                    }}
                    nodes={nodes}
                    edges={edges}
                >
                    <ProjectSurfaceBehindEditor>
                    <MediaViewerProvider>
                        <LayoutActionsProvider value={{ relayoutParent, ungroup }}>
                        <div
                            className="flex w-full flex-col bg-warm-page overflow-hidden"
                            style={{ height: 'var(--clash-project-editor-height, 100vh)' }}
                        >
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
                            {/* Presence Bar - Top Right, shifts left to avoid overlap with sidebar / expand button */}
                            <motion.div
                                className="absolute top-6 z-10 pointer-events-auto"
                                animate={{ right: isSidebarCollapsed ? 80 : sidebarWidth + 24 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            >
                                <PresenceBar clients={otherClients} />
                            </motion.div>

                            {/* Activity Toasts */}
                            <ActivityToast
                                toasts={toasts}
                                dismiss={dismissToast}
                                sidebarWidth={sidebarWidth}
                                isSidebarCollapsed={isSidebarCollapsed}
                            />

                            {/* Logo + Project Name - No Background.
                                z-10 — same stacking band as toolbar / chatbot panel
                                so modal dialogs cover it cleanly without backdrop tricks. */}
                            <div id="editor-header" className="absolute top-6 left-[36px] z-10 flex items-center pointer-events-auto">
                                <Link to="/" className="group">
                                    <motion.div
                                        className="flex items-center gap-1"
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        <span className="font-display text-4xl font-bold tracking-tighter text-slate-950 leading-none">
                                            C
                                        </span>
                                        <div className="h-8 w-[6px] bg-brand -skew-x-[20deg] transform origin-center" />
                                    </motion.div>
                                </Link>

                                {/* Separator - Aligned with Toolbar Right Edge (88px from viewport left) */}
                                <div className="absolute left-[52px] h-8 w-px bg-warm-border" />

                                {/* Project Name Input */}
                                <input
                                    className="absolute left-[65px] bg-transparent text-base font-display font-medium text-slate-950 focus:outline-none focus:ring-0 placeholder-stone-400 min-w-[60px]"
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
                            <div className={`absolute inset-0 z-0 ${canvasMode === 'hand' ? '[&_.react-flow__pane]:cursor-grab [&_.react-flow__pane:active]:cursor-grabbing' : ''}`}>
                                <ReactFlow
                                    nodes={sanitizedNodes}
                                    edges={edges}
                                    onNodesChange={handleNodesChange}
                                    onEdgesChange={handleEdgesChange}
                                    onBeforeDelete={onBeforeDelete}
                                    onNodesDelete={onNodesDelete}
                                    onNodeDragStop={onNodeDragStop}
                                    onConnect={onConnect}
                                    onSelectionChange={onSelectionChange}
                                    onSelectionStart={() => setIsMarqueeing(true)}
                                    onSelectionEnd={() => setIsMarqueeing(false)}

                                    nodeTypes={nodeTypes}
                                    fitView
                                    minZoom={0.1}
                                    selectionOnDrag={canvasMode === 'select'}
                                    panOnDrag={canvasMode === 'select' ? [1, 2] : true}
                                    selectionMode={SelectionMode.Partial}
                                    deleteKeyCode={['Backspace', 'Delete']}
                                    multiSelectionKeyCode="Shift"
                                    defaultEdgeOptions={{
                                        interactionWidth: 30,
                                        focusable: true,
                                        selectable: true,
                                        deletable: true,
                                    }}
                                    proOptions={{ hideAttribution: true }}
                                >
                                    <Background
                                        variant={BackgroundVariant.Dots}
                                        gap={12}
                                        size={1.5}
                                        color="var(--canvas-dot)"
                                        style={{ backgroundColor: 'var(--canvas-bg)' }}
                                    />

                                    {/* Collaboration: node-level activity indicators */}
                                    <NodeActivityIndicator highlights={highlights} />

                                    {/* Debug: show node IDs as selectable labels */}
                                    {showDebugIds && <DebugNodeIds nodes={nodes} />}

                                    {/* Floating "Group" pill — appears above marquee/shift selection of 2+ siblings */}
                                    <SelectionGroupButton bounds={selectionBounds} onGroup={groupSelectedNodes} />

                                    {/* Live cursor + selection awareness from other peers.
                                        Must be inside ReactFlow so it can read viewport
                                        (zoom/pan) for translating flow-coords → screen. */}
                                    <AwarenessLayer
                                        peers={awareness.peers}
                                        setLocalCursor={awareness.setLocalCursor}
                                    />

                                    {/* Unix-pipe cascade dispatcher: adopts drafts on run
                                        request, propagates cascadeToken across stages. */}
                                    <CascadeRunnerMount />

                                </ReactFlow>
                            </div>

                            {/* Left Toolbar - Vertical Palette.
                                z-10 keeps it above the canvas (z-0) but well below
                                any modal Dialog (z-[70]) — same stacking band as the
                                ChatbotCopilot panel, which has no explicit z-index
                                (relies on natural document flow above the canvas). */}
                            <div ref={toolbarRef} className="absolute left-6 top-1/2 -translate-y-1/2 z-10 flex flex-col items-start gap-2 pointer-events-none">
                                 <div className="clash-canvas-toolbar-surface pointer-events-auto flex w-16 flex-none flex-col items-center gap-3 rounded-full py-6 px-3 transition-all">
                                    {/* Canvas Mode Toggle: single button switches between select/hand */}
                                    <motion.button
                                        onClick={() => setCanvasMode(prev => prev === 'select' ? 'hand' : 'select')}
                                        className="clash-toolbar-button flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-stone-500 hover:text-slate-950 transition-all"
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        title={canvasMode === 'select' ? 'Select mode (V)' : 'Hand mode (H)'}
                                    >
                                        {canvasMode === 'select'
                                            ? <CursorClick className="h-5 w-5" weight="regular" />
                                            : <HandGrabbing className="h-5 w-5" weight="fill" />
                                        }
                                    </motion.button>

                                    {/* Divider */}
                                    <div className="clash-control-divider w-8 h-px" />

                                    {toolbarMenu.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = activeMenu === item.id;
                                        // Check if item has 'items' property (submenu)
                                        const hasSubmenu = 'items' in item;

                                        return (
                                            <div key={item.id} className="relative">
                                                <motion.button
                                                    onClick={(event) => {
                                                        if (hasSubmenu) {
                                                            const buttonRect = event.currentTarget.getBoundingClientRect();
                                                            setActiveMenuPosition({
                                                                top: buttonRect.top,
                                                                left: buttonRect.right + 16,
                                                            });
                                                            setActiveMenu(isActive ? null : item.id);
                                                        } else {
                                                            handleToolClick(item.id);
                                                            setActiveMenu(null);
                                                        }
                                                    }}
                                                    className={`clash-toolbar-button flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                                                        isActive
                                                        ? "clash-toolbar-button-active text-white"
                                                        : "bg-transparent text-stone-500 hover:text-slate-950"
                                                    }`}
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    title={item.label}
                                                >
                                                    <Icon className="h-5 w-5" weight={isActive ? "fill" : "regular"} />
                                                </motion.button>

                                            </div>
                                        );
                                    })}

                                    {/* Divider */}
                                    <div className="clash-control-divider w-8 h-px" />

                                    {/* Helper Tools (Undo/Redo/Layout) */}
                                    <motion.button
                                         onClick={onLayout}
                                         className="clash-toolbar-button flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-stone-500 transition-all hover:text-slate-950"
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
                                             ? "clash-toolbar-button text-stone-500 hover:text-slate-950"
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
                                             ? "clash-toolbar-button text-stone-500 hover:text-slate-950"
                                             : "text-slate-300 cursor-not-allowed"
                                         }`}
                                         whileHover={loroSync.canRedo ? { scale: 1.05 } : {}}
                                         whileTap={loroSync.canRedo ? { scale: 0.95 } : {}}
                                         title="Redo"
                                     >
                                         <ArrowClockwise className="h-5 w-5" weight="bold" />
                                     </motion.button>

                                     {/* Debug: toggle node IDs (dev only) */}
                                     {process.env.NODE_ENV === 'development' && (
                                         <>
                                         <div className="clash-control-divider w-8 h-px" />
                                         <motion.button
                                             onClick={() => setShowDebugIds(v => !v)}
                                             className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                                                 showDebugIds
                                                 ? "bg-green-600 text-white shadow-md"
                                                 : "clash-toolbar-button bg-transparent text-stone-400 hover:text-slate-950"
                                             }`}
                                             whileHover={{ scale: 1.05 }}
                                             whileTap={{ scale: 0.95 }}
                                             title="Toggle Node IDs"
                                         >
                                              <span className="font-mono text-xs font-bold">ID</span>
                                          </motion.button>
                                          </>
                                      )}
                                  </div>
                                  {typeof document !== 'undefined' && createPortal(
                                      <AnimatePresence>
                                          {activeToolbarMenu && (
                                              <motion.div
                                                  ref={toolbarFlyoutRef}
                                                  initial={{ opacity: 0, x: 8, scale: 0.96 }}
                                                  animate={{ opacity: 1, x: 0, scale: 1 }}
                                                  exit={{ opacity: 0, x: 8, scale: 0.96 }}
                                                  style={{ top: activeMenuPosition.top, left: activeMenuPosition.left }}
                                                  className="clash-canvas-toolbar-flyout-layer clash-canvas-menu-surface pointer-events-auto fixed flex flex-col gap-1 rounded-2xl p-2 min-w-[140px] z-50"
                                              >
                                                  <div className="px-2 py-1 text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">
                                                      {activeToolbarMenu.label}
                                                  </div>
                                                  {activeToolbarMenu.items.map((subItem) => {
                                                      const SubIcon = subItem.icon;
                                                      return (
                                                          <motion.button
                                                              key={subItem.id}
                                                              onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  handleToolClick(subItem.id);
                                                                  setActiveMenu(null);
                                                              }}
                                                              className="clash-input-icon-button flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-600 hover:text-slate-950 transition-colors text-left whitespace-nowrap"
                                                              whileHover={{ x: 2 }}
                                                          >
                                                              <SubIcon className="h-4 w-4" />
                                                              <span className="whitespace-nowrap">{subItem.label}</span>
                                                          </motion.button>
                                                      );
                                                  })}
                                              </motion.div>
                                          )}
                                      </AnimatePresence>,
                                      document.body
                                  )}
                             </div>

                            <div
                                id="copilot-container"
                                className="fixed bottom-3 right-3 z-40 pointer-events-none"
                                style={{ top: 'calc(var(--clash-desktop-chrome-height, 0px) + 0.75rem)' }}
                            >
                                <div className="pointer-events-auto h-full">
                                    <GroupChatPanel
                                        projectId={project.id}
                                        userId={project.ownerId}
                                        presenceClients={presenceClients}
                                        width={sidebarWidth}
                                        onWidthChange={setSidebarWidth}
                                        isCollapsed={isSidebarCollapsed}
                                        onCollapseChange={setIsSidebarCollapsed}
                                        registerRoomSink={registerRoomSink}
                                    />
                                </div>
                            </div>
                        </div>
                        </div>
                        </LayoutActionsProvider>
                    </MediaViewerProvider>
                    </ProjectSurfaceBehindEditor>
                </VideoEditorProvider>
                </VideoClipperProvider>
              </ImageEditorProvider>
              </PresenceAwarenessProvider>
            </LoroSyncProvider>
        </ProjectProvider >
    );
}
