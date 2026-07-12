
import { useCallback, useState, useEffect, useRef, useMemo, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
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
    type ReactFlowInstance,
    useViewport,
    SelectionMode,
} from '@xyflow/react';

// Use a flexible data type to preserve v11-style data access patterns throughout the codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppNode = Node<Record<string, any>>;
type AgentFollowTarget = { nodeId: string; canvasId: string };
import '@xyflow/react/dist/style.css';
import { motion } from 'framer-motion';
import { Toolbar } from 'radix-ui';
import {
    FilmSlate,
    TextT,
    Image as ImageIcon,
    SpeakerHigh,
    MagicWand,
    Sparkle,
    ArrowLeft,
    ArrowCounterClockwise,
    ArrowClockwise,
    UploadSimple,
    Square,
    PuzzlePiece,
    CursorClick,
    HandGrabbing,
} from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import type { Project, ProjectAsset } from '@clash/web-ui/lib/types';
import ChatbotCopilot from './ChatbotCopilot';
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
import { VideoEditorProvider } from './VideoEditorContext';
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
import { actionIsCheckpointLocked } from '@clash/web-ui/lib/actionCheckpoint';
import { LoroSyncProvider } from './LoroSyncContext';
import {
  Canvas,
  type ActivityMessage,
  type ProjectCanvas,
  type ProjectTimeline,
} from '@clash/shared-types';
import ActivityToast, { useActivityToasts } from './ActivityToast';
import NodeActivityIndicator, { useNodeHighlights } from './NodeActivityIndicator';
import AwarenessLayer from './AwarenessLayer';
import { PresenceAwarenessProvider } from './PresenceAwarenessContext';
import { usePresenceAwareness } from '@clash/web-ui/hooks/usePresenceAwareness';
import type { AwarenessBroadcastMessage } from '@clash/shared-types';
import { CascadeRunnerMount } from '@clash/web-ui/hooks/useCascadeRunner';
import { CustomActionDefinitionSchema, MODEL_CARDS } from '@clash/shared-types';
import { useCustomActions } from '@clash/web-ui/hooks/useCustomActions';
import { CustomActionsProvider } from './CustomActionsContext';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '@clash/web-ui/lib/loroNodeSync';
import { calculateScaledDimensions } from './nodes/assetNodeSizing';
import { getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import { DESKTOP_TAB_TITLE_EVENT, type DesktopTabTitleEventDetail } from '@clash/web-ui/lib/desktopTabs';
import { dispatchHostMutationEvent } from '@clash/web-ui/lib/hostMutationEvents';
import { sanitizeNodesForReactFlow } from '@clash/web-ui/lib/canvasNodeOrder';
import UserControls from './UserControls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Input } from './ui/input';
import { Tooltip } from './ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import ProjectWorkspaceNavigator, {
  type ProjectWorkspaceSurface,
} from "./ProjectWorkspaceNavigator";
import {
  ProjectAssetsSurface,
  ProjectTimelineEditorSurface,
} from "./ProjectWorkspaceSurfaces";

const CHILD_NODE_Z_INDEX_BASE = 1000;

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        !!target.closest('[contenteditable="true"]')
    );
}
const DEFAULT_COPILOT_PANEL_FRACTION = 1 / 3;
const MAX_COPILOT_PANEL_FRACTION = 3 / 7;
const MIN_COPILOT_PANEL_WIDTH = 420;

function clampCopilotPanelWidth(width: number) {
    if (typeof window === 'undefined') return width;
    const maxWidth = Math.max(MIN_COPILOT_PANEL_WIDTH, Math.round(window.innerWidth * MAX_COPILOT_PANEL_FRACTION));
    return Math.max(MIN_COPILOT_PANEL_WIDTH, Math.min(maxWidth, width));
}

function defaultCopilotPanelWidth() {
    if (typeof window === 'undefined') return 720;
    return clampCopilotPanelWidth(Math.round(window.innerWidth * DEFAULT_COPILOT_PANEL_FRACTION));
}

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

const sanitizeNodes = (nodes: AppNode[]): AppNode[] => {
    return sanitizeNodesForReactFlow(nodes, {
        onInvalidParent: (node, parentId) => {
            console.warn(`[Sanitize] Removing invalid parentId ${parentId} from node ${node.id}`);
        },
    });
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
    bounds: { absMinX: number; absMinY: number; absMaxX: number; absMaxY: number;
  } | null;
    onGroup: () => void;
}) {
    const { x, y, zoom } = useViewport();
    if (!bounds) return null;

    const screenLeft = bounds.absMinX * zoom + x;
    const screenTop = bounds.absMinY * zoom + y;
    const screenWidth = (bounds.absMaxX - bounds.absMinX) * zoom;

    return (
        <div className="pointer-events-none absolute inset-0 overflow-visible" style={{ zIndex: 10000 }}>
            <Tooltip label="Wrap selected nodes in a new Group">
                <Button
                    onClick={onGroup}
                    leftIcon={<Square className="h-3.5 w-3.5" weight="regular" />}
                    size="sm"
                    shape="rounded"
                    className="nodrag nopan pointer-events-auto absolute h-7 min-h-7 rounded-md border-warm-border bg-white/90 px-2.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900"
                    style={{
                        left: screenLeft + screenWidth / 2,
                        top: screenTop - 36,
                        transform: 'translateX(-50%)',
                    }}
                >
                    Group
                </Button>
            </Tooltip>
        </div>
    );
}

function DebugNodeIds({ nodes }: { nodes: AppNode[] }) {
    const { x, y, zoom } = useViewport();

    // Build absolute positions by traversing parent chain
    const posById = useMemo(() => {
        const map = new Map<string, { x: number; y: number }>();
        const getAbs = (node: AppNode): { x: number; y: number } => {
            if (map.has(node.id)) return map.get(node.id)!;
            let { x: nx, y: ny } = node.position;
            if (node.parentId) {
                const parent = nodes.find((n) => n.id === node.parentId);
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
            <Accordion
                type="single"
                collapsible
                style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' }}
            >
                {nodes.map((node) => {
                    const d = node.data ?? {};
                    const parts = [node.id];
                    if (d.status) parts.push(d.status);
                    if (d.pendingTask) parts.push(`task:${d.pendingTask.slice(0, 8)}`);
                    if (d.src) parts.push('src:✓');
                    if (d.description) parts.push('desc:✓');
                    if (d.error) parts.push(`err:${d.error.slice(0, 20)}`);
                    if (d.modelId) parts.push(d.modelId);
                    if (d._log?.length) parts.push(`log:${d._log.length}`);
                    const abs = posById.get(node.id) ?? node.position;
                    return (
                        <AccordionItem
                            key={`dbg-${node.id}`}
                            value={node.id}
                            className="pointer-events-auto absolute cursor-pointer"
                            style={{
                                left: abs.x,
                                top: abs.y - 20,
                            }}
                        >
                            <AccordionTrigger asChild>
                                <Button
                                    aria-label={`Toggle debug details for ${node.id}`}
                                    className="h-auto min-h-0 rounded border-0 bg-black/85 px-1.5 py-0.5 font-mono text-[10px] text-green-400 shadow-none hover:bg-black/85 hover:text-green-300"
                                >
                                    <span className="whitespace-nowrap select-all">
                                        {parts.join(' | ')}
                                    </span>
                                </Button>
                            </AccordionTrigger>
                            {d._log?.length > 0 && (
                                <AccordionContent>
                                <div className="mt-1 rounded bg-black/90 p-2 font-mono text-[10px] text-gray-300 max-w-[400px] max-h-[200px] overflow-auto">
                                    {d._log.map((entry: string, i: number) => (
                                        <div key={i} className={entry.includes('FAILED') ? 'text-red-400' : ''}>{entry}</div>
                                    ))}
                                </div>
                                </AccordionContent>
                            )}
                        </AccordionItem>
                    );
                })}
            </Accordion>
        </div>
    );
}

export default function ProjectEditor({ project, initialPrompt, initialThreadId, globalActions = [] }: ProjectEditorProps) {
    const [activeCanvasId, setActiveCanvasId] = useState("main");
    const [workspaceSurface, setWorkspaceSurface] =
    useState<ProjectWorkspaceSurface>({
      kind: "canvas",
      canvasId: "main",
    });
    const activeCanvasIdRef = useRef(activeCanvasId);
    const workspaceSurfaceRef = useRef(workspaceSurface);
    activeCanvasIdRef.current = activeCanvasId;
    workspaceSurfaceRef.current = workspaceSurface;

    const [followingAgent, setFollowingAgent] = useState(false);
    const followingAgentRef = useRef(false);
    const lastAgentTargetRef = useRef<AgentFollowTarget | null>(null);
    const pendingAgentTargetRef = useRef<AgentFollowTarget | null>(null);
    const queueAgentFollowTargetRef = useRef<(target: AgentFollowTarget) => void>(() => {});
    const reactFlowInstanceRef = useRef<ReactFlowInstance<AppNode, Edge> | null>(null);

    const setFollowingAgentMode = useCallback((following: boolean) => {
      followingAgentRef.current = following;
      setFollowingAgent(following);
      if (!following) {
        pendingAgentTargetRef.current = null;
        return;
      }
      if (lastAgentTargetRef.current) {
        queueAgentFollowTargetRef.current(lastAgentTargetRef.current);
      }
    }, []);

    const stopFollowingAgent = useCallback(() => {
      if (followingAgentRef.current) setFollowingAgentMode(false);
    }, [setFollowingAgentMode]);

    const recordAgentTarget = useCallback((nodeId: string, canvasId?: string) => {
      const id = nodeId.trim();
      if (!id) return;
      const target = {
        nodeId: id,
        canvasId: canvasId?.trim() || activeCanvasIdRef.current,
      };
      lastAgentTargetRef.current = target;
      if (followingAgentRef.current) queueAgentFollowTargetRef.current(target);
    }, []);

    // Loro remains the single source of truth. These asset-ref nodes are only
    // a recovery bootstrap for old projects whose Loro document is empty while
    // the project still owns media assets.
    const [nodes, setNodesInternal] = useNodesState<AppNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const nodesRef = useRef<AppNode[]>(nodes);
    const edgesRef = useRef<Edge[]>(edges);

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);
    useEffect(() => {
        edgesRef.current = edges;
    }, [edges]);

    // Wrap setNodes to ALWAYS sanitize before setting - this prevents "Parent node X not found" errors
    // The sanitization must happen BEFORE nodes are set to state, not after
    const setNodes = useCallback((updater: Node[] | ((nodes: Node[]) => Node[])) => {
        setNodesInternal((currentNodes) => {
            const newNodes = typeof updater === 'function' ? updater(currentNodes) : updater;
            return sanitizeNodes(newNodes);
        });
    }, [setNodesInternal]);
    const [projectName, setProjectName] = useState(project.name);
    const projectTitleInputRef = useRef<HTMLInputElement>(null);
    const location = useLocation();
    const [showDebugIds, setShowDebugIds] = useState(false);
    const [canvasMode, setCanvasMode] = useState<'select' | 'hand'>('select');
    useHotkeys('mod+shift+i', () => setShowDebugIds((visible) => !visible), {
        enabled: process.env.NODE_ENV === 'development',
        preventDefault: true,
    });
    const handleProjectNameSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        projectTitleInputRef.current?.blur();
    };

    useEffect(() => {
        const detail: DesktopTabTitleEventDetail = {
            path: location.pathname,
            title: projectName || project.name || 'Untitled',
        };
        window.dispatchEvent(new CustomEvent(DESKTOP_TAB_TITLE_EVENT, { detail }));
    }, [location.pathname, project.name, projectName]);

    const { toasts, addToast, dismiss: dismissToast } = useActivityToasts();
    const { highlights, addHighlight } = useNodeHighlights();

    // Awareness: live cursor + selection over the same WS.
    // The handler ref is set by usePresenceAwareness below; useLoroSync
    // forwards every `awareness.broadcast` frame into it.
    const awarenessSinkRef = useRef<((msg: AwarenessBroadcastMessage) => void) | null>(null);
    const flowBoundsRef = useRef<HTMLDivElement | null>(null);
    const registerOnAwareness = useCallback(
        (handler: ((msg: AwarenessBroadcastMessage) => void) | null) => {
            awarenessSinkRef.current = handler;
        },
        [],
    );

    // Loro CRDT sync
    const loroSync = useLoroSync({
        projectId: project.id,
    canvasId: activeCanvasId,
        onActivity: (activity: ActivityMessage) => {
            addToast(activity);
            addHighlight(activity);
            if (activity.actor.clientType === "agent" && activity.action !== "deleted") {
              recordAgentTarget(activity.nodeId, activity.canvasId);
            }
        },
        onMutation: (mutation) => dispatchHostMutationEvent(project.id, mutation),
    onAwareness: (msg) => {
            awarenessSinkRef.current?.(msg);
        },
        onNodesChange: (syncedNodes) => {
      // Loro is the SINGLE SOURCE OF TRUTH - use its state directly
      // Only preserve spatial state during active interaction (drag/resize).
      // Selection is UI-only and should NOT block remote/local layout updates.
            const currentNodes = nodesRef.current;
                const currentNodesMap = new Map(currentNodes.map((n) => [n.id, n]));

                let processedNodes = syncedNodes.map((syncedNode) => {
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
                    const currentEdges = edgesRef.current;

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
                            const layoutedNode = processedNodes.find((n) => n.id === node.id);
                            if (layoutedNode && !needsAutoLayout(layoutedNode)) {
                                loroSyncRef.current.updateNode(node.id, {
                                    position: layoutedNode.position,
                                });
                            }
                        }

                        // Also sync pushed nodes positions
                        for (const node of processedNodes) {
                            const original = syncedNodes.find((n) => n.id === node.id);
                            if (original && !nodesToLayout.some((n) => n.id === node.id)) {
                                if (node.position.x !== original.position.x || node.position.y !== original.position.y) {
                                    loroSyncRef.current?.updateNode(node.id, {
                                        position: node.position,
                                    });
                                }
                            }
                        }

                        // Sync group size changes
                        for (const node of processedNodes) {
                            const original = syncedNodes.find((n) => n.id === node.id);
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

            nodesRef.current = processedNodes as AppNode[];
            setNodes(processedNodes);
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

    useEffect(() => {
        if (loroSync.canvases.length === 0) return;
        if (loroSync.canvases.some((canvas) => canvas.id === activeCanvasId))
      return;
    const nextCanvasId = loroSync.canvases[0].id;
    setActiveCanvasId(nextCanvasId);
    setWorkspaceSurface({ kind: "canvas", canvasId: nextCanvasId });
  }, [activeCanvasId, loroSync.canvases]);

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
    const [sidebarWidth, setSidebarWidth] = useState(defaultCopilotPanelWidth);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isProjectNavigatorCollapsed, setIsProjectNavigatorCollapsed] = useState(false);
    const [sidebarHydrated, setSidebarHydrated] = useState(false);
    const isCopilotDocked = workspaceSurface.kind !== "canvas" && !isSidebarCollapsed;

    useEffect(() => {
        const savedWidth = localStorage.getItem('copilot-sidebar-width');
        if (savedWidth) {
            const parsedWidth = parseInt(savedWidth, 10);
            const nextDefault = defaultCopilotPanelWidth();
            setSidebarWidth(Number.isFinite(parsedWidth) && parsedWidth >= MIN_COPILOT_PANEL_WIDTH
                ? clampCopilotPanelWidth(parsedWidth)
                : nextDefault);
        }
        setIsSidebarCollapsed(localStorage.getItem('copilot-sidebar-collapsed') === 'true');
        setIsProjectNavigatorCollapsed(localStorage.getItem('project-navigator-collapsed') === 'true');
        setSidebarHydrated(true);
    }, []);

    useEffect(() => {
        if (sidebarHydrated) localStorage.setItem('copilot-sidebar-width', String(sidebarWidth));
    }, [sidebarWidth, sidebarHydrated]);
    useEffect(() => {
        if (sidebarHydrated) localStorage.setItem('copilot-sidebar-collapsed', String(isSidebarCollapsed));
    }, [isSidebarCollapsed, sidebarHydrated]);
    useEffect(() => {
        if (sidebarHydrated) localStorage.setItem('project-navigator-collapsed', String(isProjectNavigatorCollapsed));
    }, [isProjectNavigatorCollapsed, sidebarHydrated]);

    // Chat session state
    const [threadId, setThreadId] = useState<string>(initialThreadId || '');
    const [sessionKey, setSessionKey] = useState(0);
    const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>(initialPrompt);
    const editorRouter = useNavigate();
    const { sessions: sessionHistory, upsertSession, deleteSession: removeSession } = useSessionHistory(project.id);

    const handleReturnToProjects = useCallback(() => {
        editorRouter('/projects');
    }, [editorRouter]);

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
        lastAgentTargetRef.current = null;
        setFollowingAgentMode(false);
        setChatInitialPrompt(undefined);
        setThreadId('');
        setSessionKey((k) => k + 1);
    }, [setFollowingAgentMode]);

    const handleSwitchSession = useCallback((id: string) => {
        lastAgentTargetRef.current = null;
        setFollowingAgentMode(false);
        setChatInitialPrompt(undefined);
        setThreadId(id);
    }, [setFollowingAgentMode]);

    const handleDeleteSession = useCallback((id: string) => {
        removeSession(id);
        if (id === threadId) {
            lastAgentTargetRef.current = null;
            setFollowingAgentMode(false);
            setThreadId('');
        }
    }, [removeSession, setFollowingAgentMode, threadId]);

    const handleCopilotCreateSession = useCallback(async (initialMessage: string) => {
        const result = await handleCreateSession(initialMessage);
        if (!result) throw new Error('Failed to create session');
        upsertSession({ threadId: result.threadId, title: result.title, type: 'cloud' });
        setChatInitialPrompt(initialMessage);
        setThreadId(result.threadId);
        setSessionKey((k) => k + 1);
    }, [handleCreateSession, upsertSession]);

    // Auto-create session for initialPrompt from HomePage. The initial prompt
    // rides along on chatInitialPrompt → ChatbotCopilot's mount-time
    // queueMessageOnOpen. The threadId-keyed remount makes the new mount
    // pick it up cleanly.
    const hasCreatedSessionRef = useRef(false);
    useEffect(() => {
        if (initialPrompt && !threadId && !hasCreatedSessionRef.current) {
            hasCreatedSessionRef.current = true;
            handleCreateSession(initialPrompt).then((result) => {
                if (result) {
                    upsertSession({ threadId: result.threadId, title: result.title, type: 'cloud' });
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
	    const sanitizedNodes = useMemo(() => sanitizeNodes(nodes), [nodes]);


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
	        const currentNodes = nodesRef.current;
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

	        // Always sanitize before returning to ReactFlow - removes invalid parentId references.
	        // Keep CRDT writes outside React state updater functions because React may replay them.
	        const nextNodes = sanitizeNodes(updatedNodes) as AppNode[];
	        nodesRef.current = nextNodes;
	        setNodes(nextNodes);

        // Handle node deletions - sync to Loro (Fallback if onNodesDelete doesn't fire)
        const removeChanges = changes.filter((c) => c.type === 'remove');
        if (removeChanges.length > 0) {
            loroSync.removeNodes(removeChanges.map((change) => change.id));
        }

    }, [setNodes, loroSync, applyAutoZIndex]);

    // GC-style protection: a canvas asset that's been consumed by a
    // materialized ActionBadge checkpoint can't be silently yanked out from
    // under it. A previously run action without materialized downstream is
    // still editable; the checkpoint boundary is the downstream output.
    const onBeforeDelete = useCallback(async ({ nodes: nds, edges: eds }: { nodes: Node[]; edges: Edge[] }) => {
        const checkpointActionIds = new Set<string>();
        for (const n of nodes) {
            if (n.type === 'action-badge' && actionIsCheckpointLocked({ nodeId: n.id, nodes, edges })) {
                checkpointActionIds.add(n.id);
            }
        }
        if (checkpointActionIds.size === 0) return { nodes: nds, edges: eds };

        const lockedEdgeIds = new Set<string>();
        const pinnedNodeIds = new Set<string>();
        for (const e of edges) {
            if (checkpointActionIds.has(e.target)) {
                lockedEdgeIds.add(e.id);
                pinnedNodeIds.add(e.source);
            }
        }

        const allowedNodes = nds.filter((n) => !pinnedNodeIds.has(n.id));
        const allowedEdges = eds.filter((e) => !lockedEdgeIds.has(e.id));
        return { nodes: allowedNodes, edges: allowedEdges };
    }, [nodes, edges]);

    // Reliable sync handlers
    const onNodesDelete = useCallback((deletedNodes: Node[]) => {
        const persistedDeletedNodes = loroSync.removeNodes(deletedNodes.map((node) => node.id))
            ? deletedNodes
            : [];

        // Drop project's asset_refs row for any assetId no longer referenced by any surviving node.
        // Other projects sharing the same asset are unaffected (M:N).
        const deletedIds = new Set(persistedDeletedNodes.map((n) => n.id));
        const survivingAssetIds = new Set(
            nodes
                .filter((n) => !deletedIds.has(n.id))
                .map(
            (n) => (n.data as Record<string, unknown>)?.assetId as string | undefined)
                .filter((v): v is string => !!v),
        );
        const orphanedAssetIds = new Set(
            persistedDeletedNodes
                .map(
            (n) => (n.data as Record<string, unknown>)?.assetId as string | undefined)
                .filter((v): v is string => !!v && !survivingAssetIds.has(v)),
        );
        orphanedAssetIds.forEach((assetId) => {
            void fetch(runtimeApiUrl(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(project.id)}`), {
                method: 'DELETE',
            }).catch((e) => console.warn('[onNodesDelete] removeAssetRef failed', assetId, e));
        });
    }, [loroSync, nodes, project.id]);

	    const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: AppNode, _allNodes: AppNode[]) => {
	        let patchesToSync: Array<{ id: string; patch: any }> = [];
	        let draggedNodePatch: any | null = null;

	        flushSync(() => {
	            setNodes((nds) => {
	                const currentNode = nds.find((n) => n.id === node.id) ?? node;
	                const draggedNode: AppNode = {
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

	                let updatedNodes = nds.map((n) =>
            n.id === draggedNode.id ? nextNode : n);

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
        if (!topLevel.every((n) => (nodesById.get(n.id) ?? n).parentId === commonParent)) return null;

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
        const groupWidth = absMaxX - absMinX + PADDING * 2;
        const groupHeight = absMaxY - absMinY + TITLE_GAP + PADDING * 2;

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
        const childUpdates: Array<{ id: string; parentId: string; position: { x: number; y: number };
    }> = [];

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
        window.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('gesturestart', onGesture as EventListener, { passive: false });
        window.addEventListener('gesturechange', onGesture as EventListener, { passive: false });
        window.addEventListener('gestureend', onGesture as EventListener, { passive: false });
        return () => {
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('gesturestart', onGesture as EventListener);
            window.removeEventListener('gesturechange', onGesture as EventListener);
            window.removeEventListener('gestureend', onGesture as EventListener);
        };
    }, []);


    // Custom handleEdgesChange to sync edge deletions to Loro
    const handleEdgesChange = useCallback((changes: import('@xyflow/react').EdgeChange[]) => {
        onEdgesChange(changes);

        // Handle edge deletions - sync to Loro
        const removeChanges = changes.filter((c) => c.type === 'remove');
        if (removeChanges.length > 0) {
            removeChanges.forEach((change) => {
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
            const currentNodes = nodesRef.current;
            const currentEdges = edgesRef.current;
            if (srcId && tgtId) {
                const src = currentNodes.find((n) => n.id === srcId);
                const tgt = currentNodes.find((n) => n.id === tgtId);
                // GC-style protection: refs of materialized checkpoints are
                // lineage, not editable inputs. Draft-only action chains remain
                // editable.
                if (tgt?.type === 'action-badge' && actionIsCheckpointLocked({ nodeId: tgt.id, nodes: currentNodes, edges: currentEdges })) {
                    console.warn(`[onConnect] rejected: target action-badge is a materialized checkpoint`);
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
            if (currentEdges.some((edge) => edge.id === canonicalId)) return;
            const nextEdges = addEdge(paramsWithDefaults as any, currentEdges);
            const addedEdge = nextEdges.find((edge) => edge.id === canonicalId);
            if (addedEdge && !loroSync.addEdge(addedEdge.id, addedEdge)) return;
            edgesRef.current = nextEdges;
            setEdges(nextEdges);
        },
        [setEdges, loroSync]
    );

    const handleGlobalHotkey = useCallback((e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
            e.preventDefault();
            return;
        }

        // Avoid triggering editor shortcuts while the user is typing.
        if (isEditableKeyboardTarget(e.target)) return;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            if (e.shiftKey) {
                if (loroSync.canRedo) {
                    e.preventDefault();
                    loroSync.redo();
                }
            } else if (loroSync.canUndo) {
                e.preventDefault();
                loroSync.undo();
            }
        }

        // Ctrl/Cmd+Shift+D: toggle debug node IDs (dev only)
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D' && process.env.NODE_ENV === 'development') {
            e.preventDefault();
            setShowDebugIds((v) => !v);
        }

        // Del/Backspace: delete selected edges (ReactFlow's deleteKeyCode isn't firing reliably).
        // Honor the same checkpoint guard as `onBeforeDelete`.
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const checkpointActionIds = new Set(
                nodes
                    .filter(
              (n) => n.type === 'action-badge' && actionIsCheckpointLocked({ nodeId: n.id, nodes, edges }))
                    .map((n) => n.id),
            );
            const selectedEdgeIds = edges
                .filter((ed) => ed.selected && !checkpointActionIds.has(ed.target))
                .map((ed) => ed.id);
            if (selectedEdgeIds.length > 0) {
                e.preventDefault();
                setEdges((eds) => eds.filter((ed) => !selectedEdgeIds.includes(ed.id)));
                selectedEdgeIds.forEach((eid) => loroSync.removeEdge(eid));
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
            setCanvasMode((prev) => {
                canvasModeBeforeSpace.current = prev;
                return 'hand';
            });
        }
    }, [edges, loroSync, nodes, setEdges]);

    const handleSpaceKeyUp = useCallback((e: KeyboardEvent) => {
        if (isEditableKeyboardTarget(e.target)) return;
        if (e.key === ' ') {
            setCanvasMode(canvasModeBeforeSpace.current);
        }
    }, []);

    useHotkeys('*', handleGlobalHotkey, {
        enableOnContentEditable: true,
        enableOnFormTags: true,
        keydown: true,
        keyup: false,
    }, [handleGlobalHotkey]);
    useHotkeys('*', handleSpaceKeyUp, {
        enableOnContentEditable: true,
        enableOnFormTags: true,
        keydown: false,
        keyup: true,
    }, [handleSpaceKeyUp]);

    // Merge local (Loro) + global (D1) custom actions, deduplicate by ID
    const loroActions = useCustomActions(loroSync.doc);
    const customActions = useMemo(() => {
        const merged = new Map<string, (typeof loroActions)[number]>();
        // Global actions first (from D1)
        for (const ga of globalActions) {
            try {
                const parsed = CustomActionDefinitionSchema.safeParse({
                    ...JSON.parse(ga.manifest),
                    id: ga.actionId,
                    name: ga.name,
                    description: ga.description || undefined,
                    runtime: (ga.runtime as 'local' | 'worker') || 'worker',
                    version: ga.version || undefined,
                    author: ga.author || undefined,
                    workerUrl: ga.workerUrl || undefined,
                    icon: ga.icon || undefined,
                    color: ga.color || undefined,
                });
                if (parsed.success) merged.set(ga.actionId, parsed.data);
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

    const addNode = useCallback((type: string, extraData: any = {}) => {
      if (type === "video-editor") {
        const actionNodeId = extraData.id || `timeline-action-${Date.now()}`;
        const timelineId = extraData.timelineId || `timeline-${Date.now()}`;
        const name =
          typeof extraData.label === "string" && extraData.label.trim()
            ? extraData.label.trim()
            : "Untitled Timeline";
        const created = loroSync.createTimeline({
          id: timelineId,
          name,
          state: { tracks: [] },
        });
        if (!created.ok) {
          console.error(`[ProjectEditor] ${created.error}`);
          return "";
        }
        const attached = loroSync.attachTimeline({
          timelineId,
          actionNodeId,
          position: extraData.position ?? { x: 100, y: 100 },
        });
        if (!attached.ok) {
          console.error(`[ProjectEditor] ${attached.error}`);
          return "";
        }
        return actionNodeId;
      }

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
        const nds = nodesRef.current;

        // If caller didn't specify a parentId, default to "current group context":
        // - Prefer the selected group (deepest if multiple)
        // - Otherwise, use the parentId of the first selected node (if any)
        let insertionParentId: string | undefined = extraData.parentId;
        if (!insertionParentId && selectedNodes.length > 0) {
            const byId = new Map(nds.map((n) => [n.id, n]));
            const selectedGroups = selectedNodes
                .map((n) => byId.get(n.id) ?? n)
                .filter((n) => n.type === 'group');

            if (selectedGroups.length > 0) {
                insertionParentId = selectedGroups
                    .slice()
                    .sort((a, b) => getNestingDepth(b.id, nds) - getNestingDepth(a.id, nds))[0]?.id;
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
                const parent = nds.find((n) => n.id === extraData.parentId);
                const parentZIndex = Number(parent?.style?.zIndex ?? 0);
                zIndex = parentZIndex + 1;
            } else {
                // Root Group: Keep existing logic (behind other groups)
                const groupNodes = nds.filter((n) => n.type === 'group');
                const minZIndex = groupNodes.reduce((min, n) => {
                    const nodeZIndex = Number(n.style?.zIndex ?? 0);
                    return Math.min(min, nodeZIndex);
                }, 0);
                zIndex = minZIndex - 1;
            }
        }

        const newNodeId = extraData.id || `${nds.length + 1}-${Date.now()}`;
        if (nds.some((node) => node.id === newNodeId)) return newNodeId;

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
            if (Number.isFinite(extraData.width)) {
                defaultWidth = extraData.width;
                layoutWidth = extraData.width;
            }
            if (Number.isFinite(extraData.height)) {
                defaultHeight = extraData.height;
                layoutHeight = extraData.height;
            }

            // 2. Determine Position with Collision Detection
            let parentId = extraData.parentId;

            // Validate parentId exists
            if (parentId) {
                const parentExists = nds.find((n) => n.id === parentId);
                if (!parentExists) {
                    console.warn(`Parent node ${parentId} not found in current nodes list (size: ${nds.length}), creating node at root level`);
                    parentId = undefined;
                }
            }

            const explicitPosition =
                extraData.position &&
                Number.isFinite(extraData.position.x) &&
                Number.isFinite(extraData.position.y)
                    ? { x: extraData.position.x, y: extraData.position.y }
                    : null;
            let targetPos = explicitPosition ?? { x: 100, y: 100 };

            // If no parentId, place below all existing root nodes
            if (!explicitPosition && !parentId && nds.length > 0) {
                let maxBottom = 0;
                let leftmostX = Infinity;

                nds.forEach((n) => {
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

            if (parentId && !explicitPosition) {
                // Start at top-left of group
                targetPos = { x: 50, y: 50 };

                // 1. Upstream Node Placement (Highest Priority)
                const primaryUpstream = upstreamList[0];
                if (primaryUpstream) {
                    const upstreamNode = nds.find((n) => n.id === primaryUpstream);
                    if (upstreamNode) {
                        // Calculate Upstream Node's Absolute Position
                        const upstreamAbsPos = getAbsolutePosition(upstreamNode, nds);
                        const upstreamWidth = upstreamNode.width || Number(upstreamNode.style?.width) || 300;
                        const upstreamHeight = upstreamNode.height || Number(upstreamNode.style?.height) || 300;
                        const upstreamCenterY = upstreamAbsPos.y + upstreamHeight / 2;

                        // Calculate Parent Group's Absolute Position
                        const parentGroup = nds.find((n) => n.id === parentId);
                        const parentAbsPos = parentGroup ? getAbsolutePosition(parentGroup, nds) : { x: 0, y: 0 };

                        // Calculate Target Position Relative to Parent Group
                        // We want the new node to be to the right of the upstream node
                        const targetAbsX = upstreamAbsPos.x + upstreamWidth + 80;
                        const targetAbsY = upstreamCenterY - layoutHeight / 2;

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
                    const children = nds.filter((n) => n.parentId === parentId);
                    if (children.length > 0) {
                        if (extraData.layoutDirection === 'right') {
                            // Find the right-most child
                            const rightMostChild = children.reduce((prev, current) => {
                                return prev.position.x > current.position.x ? prev : current;
                            });
                            const childWidth = rightMostChild.width || Number(rightMostChild.style?.width) || layoutWidth;

                            targetPos = {
                                x: rightMostChild.position.x + childWidth + 50,
                                y: rightMostChild.position.y // Keep same Y level
                            };
                        } else {
                            // Default: Vertical stacking (bottom)
                            const bottomChild = children.reduce((prev, current) => {
                                return prev.position.y > current.position.y ? prev : current;
                            });
                            const childHeight = bottomChild.height || Number(bottomChild.style?.height) || 200;
                            targetPos = {
                                x: 50,
                                y: bottomChild.position.y + childHeight + 50
                            };
                        }
                    }
                }
            } else if (!explicitPosition) {
                // Root level placement (e.g. new groups)
                if (nodeType === 'group') {
                    // Place new group below existing groups
                    const existingGroups = nds.filter((n) => n.type === 'group');
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

            if (parentId && !explicitPosition) {
                // Inside a group: use mesh for collision-free placement
                const siblingRects = nds
                    .filter((n) => n.parentId === parentId && n.type !== 'group')
                    .map((n) => getAbsoluteRect(n, nds));
                position = mesh.findNonOverlappingPosition(
                    targetPos,
                    { width: layoutWidth, height: layoutHeight },
                    siblingRects
                );
            } else if (!explicitPosition) {
                // Root level: use the rightmost position directly
                // Only adjust if there's a direct overlap at the exact position
                const directRect = { x: targetPos.x, y: targetPos.y, width: layoutWidth, height: layoutHeight };
                const rootNodes = nds.filter((n) => !n.parentId);
                const hasDirectOverlap = rootNodes.some((n) => {
                    const nodeRect = getAbsoluteRect(n, nds);
                    return rectOverlaps(directRect, nodeRect);
                });

                if (hasDirectOverlap) {
                    // Shift down to avoid overlap
                    position = { x: targetPos.x, y: targetPos.y + layoutHeight + 50 };
                }
            }

            const explicitStyle =
                extraData.style && typeof extraData.style === 'object' && !Array.isArray(extraData.style)
                    ? extraData.style
                    : {};
            const baseStyle: Record<string, string | number | undefined> = {
                ...(explicitStyle as Record<string, string | number | undefined>),
                ...(nodeType === 'group' ? { width: layoutWidth, height: layoutHeight, zIndex } : {}),
            };
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
            const finalNodes = sanitizeNodes(updatedNodes) as AppNode[];
            nodesRef.current = finalNodes;
            setNodes(finalNodes);

            // Persist derived layout updates (group resize / collision resolution)
            applyLayoutPatchesToLoro(loroSync, collectLayoutNodePatches(nds, finalNodes));

            // Sync new node to Loro
            const createdNode = finalNodes.find((n) => n.id === newNodeId);
            if (createdNode) {
                loroSync.addNode(newNodeId, createdNode);
            }

        return newNodeId;
    }, [selectedNodes, setNodes, loroSync, applyAutoZIndex, customActions]);

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

    const uploadFileAsAssetNode = useCallback(
        async (
            file: File,
            assetType: 'image' | 'video' | 'audio'
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
            createdAt: number;
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
                    createdAt: Date.now(),
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
        [addNode, loroSync, project.id, setNodes]
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
                if (rest.parentId && !nodes.find((n) => n.id === rest.parentId)) {
                    console.warn(`Parent node ${rest.parentId} not found in command, creating node at root level`);
                    delete rest.parentId;
                }

                // Generate semantic ID
                const nodeId = await generateSemanticId(project.id);

          if (type === "video-editor") {
            addNode("video-editor", {
              id: nodeId,
              ...(data || {}),
              position: rest.position,
            });
            break;
          }

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
    }, [addNode, nodes, edges, setNodes, setEdges, project.id]);

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
            const currentNodes = nodesRef.current;
            const updated = applyRelayout(currentNodes, edgesRef.current, parentId);
            nodesRef.current = updated;
            setNodes(updated);
            applyLayoutPatchesToLoro(loroSync, collectLayoutNodePatches(currentNodes, updated));
        },
        [setNodes, applyRelayout, loroSync]
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
        const node = nodes.find((n) => n.data?.label === name);
        return node?.id;
    }, [nodes]);

  const activeCanvas =
    loroSync.canvases.find((canvas) => canvas.id === activeCanvasId) ??
    loroSync.canvases[0];
  const projectAssets = project.assets ?? [];
  const selectedTimeline =
    workspaceSurface.kind === "timeline"
      ? loroSync.timelines.find(
          (timeline) => timeline.id === workspaceSurface.timelineId,
        )
      : undefined;

  const openTimelineFromCanvasAction = useCallback((timelineId: string) => {
    if (!loroSync.timelines.some((timeline) => timeline.id === timelineId)) return;
    stopFollowingAgent();
    setWorkspaceSurface({ kind: "timeline", timelineId });
  }, [loroSync.timelines, stopFollowingAgent]);

  const selectCanvas = useCallback(
    (canvasId: string) => {
      activeCanvasIdRef.current = canvasId;
      workspaceSurfaceRef.current = { kind: "canvas", canvasId };
      setNodes([]);
      setEdges([]);
      setActiveCanvasId(canvasId);
      setWorkspaceSurface({ kind: "canvas", canvasId });
    },
    [setEdges, setNodes],
  );

  const focusPendingAgentTarget = useCallback(() => {
    const target = pendingAgentTargetRef.current;
    const instance = reactFlowInstanceRef.current;
    if (!target || !instance || !followingAgentRef.current) return;
    if (activeCanvasIdRef.current !== target.canvasId) return;
    const surface = workspaceSurfaceRef.current;
    if (surface.kind !== "canvas" || surface.canvasId !== target.canvasId) return;

    const currentNodes = nodesRef.current;
    const node = currentNodes.find((candidate) => candidate.id === target.nodeId);
    if (!node) return;
    const layoutRect = getAbsoluteRect(node, currentNodes);
    const internalNode = instance.getInternalNode(target.nodeId);
    const absolute = internalNode?.internals.positionAbsolute ?? {
      x: layoutRect.x,
      y: layoutRect.y,
    };
    const width = internalNode?.measured.width ?? layoutRect.width;
    const height = internalNode?.measured.height ?? layoutRect.height;
    const zoom = Math.min(Math.max(instance.getZoom(), 0.9), 1.2);
    const flowBounds = flowBoundsRef.current?.getBoundingClientRect();
    if (!flowBounds) return;
    const copilotPanel = document.querySelector<HTMLElement>('#clash-copilot-panel');
    const copilotBounds = copilotPanel?.getBoundingClientRect();
    const panelCoversCanvas =
      copilotPanel?.getAttribute('aria-hidden') !== 'true' &&
      !!copilotBounds &&
      copilotBounds.left > flowBounds.left &&
      copilotBounds.left < flowBounds.right &&
      copilotBounds.bottom > flowBounds.top &&
      copilotBounds.top < flowBounds.bottom;
    const visibleRight = panelCoversCanvas
      ? Math.max(0, copilotBounds.left - flowBounds.left - 12)
      : flowBounds.width;
    const targetCenterX = absolute.x + width / 2;
    const targetCenterY = absolute.y + height / 2;
    instance.setViewport({
      x: visibleRight / 2 - targetCenterX * zoom,
      y: flowBounds.height / 2 - targetCenterY * zoom,
      zoom,
    }, {
      duration: 420,
    });
  }, []);

  const queueAgentFollowTarget = useCallback((target: AgentFollowTarget) => {
    lastAgentTargetRef.current = target;
    if (!followingAgentRef.current) return;
    pendingAgentTargetRef.current = target;
    if (activeCanvasIdRef.current !== target.canvasId) {
      selectCanvas(target.canvasId);
    } else if (
      workspaceSurfaceRef.current.kind !== "canvas" ||
      workspaceSurfaceRef.current.canvasId !== target.canvasId
    ) {
      const surface: ProjectWorkspaceSurface = { kind: "canvas", canvasId: target.canvasId };
      workspaceSurfaceRef.current = surface;
      setWorkspaceSurface(surface);
    }
    window.requestAnimationFrame(focusPendingAgentTarget);
  }, [focusPendingAgentTarget, selectCanvas]);
  queueAgentFollowTargetRef.current = queueAgentFollowTarget;

  useEffect(() => {
    if (!pendingAgentTargetRef.current || !followingAgent) return;
    const frame = window.requestAnimationFrame(focusPendingAgentTarget);
    const settleTimer = window.setTimeout(focusPendingAgentTarget, 480);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [activeCanvasId, focusPendingAgentTarget, followingAgent, isSidebarCollapsed, nodes, sidebarWidth, workspaceSurface]);

  const selectCanvasFromNavigator = useCallback((canvasId: string) => {
    stopFollowingAgent();
    selectCanvas(canvasId);
  }, [selectCanvas, stopFollowingAgent]);

  const createCanvasFromNavigator = useCallback(() => {
    stopFollowingAgent();
    const name = window.prompt("Canvas name")?.trim();
    if (!name) return;
    const stem =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "canvas";
    const canvasId = `${stem}-${Date.now().toString(36)}`;
    const result = loroSync.createCanvas({ id: canvasId, name });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    selectCanvas(canvasId);
  }, [loroSync, selectCanvas, stopFollowingAgent]);

  const renameCanvasFromNavigator = useCallback(
    (canvas: ProjectCanvas) => {
      const name = window.prompt("Canvas name", canvas.name)?.trim();
      if (!name || name === canvas.name) return;
      const result = loroSync.renameCanvas(canvas.id, name);
      if (!result.ok) window.alert(result.error);
    },
    [loroSync],
  );

  const deleteCanvasFromNavigator = useCallback(
    (canvas: ProjectCanvas) => {
      stopFollowingAgent();
      if (!window.confirm(`Delete Canvas "${canvas.name}"?`)) return;
      const fallback = loroSync.canvases.find(
        (candidate) => candidate.id !== canvas.id,
      );
      const result = loroSync.deleteCanvas(canvas.id);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      if (activeCanvasId === canvas.id && fallback) selectCanvas(fallback.id);
    },
    [activeCanvasId, loroSync, selectCanvas, stopFollowingAgent],
  );

  const createTimelineFromNavigator = useCallback(() => {
    stopFollowingAgent();
    const name = window.prompt("Timeline name")?.trim();
    if (!name) return;
    const timelineId = `timeline-${Date.now().toString(36)}`;
    const result = loroSync.createTimeline({
      id: timelineId,
      name,
      state: { tracks: [] },
    });
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setWorkspaceSurface({ kind: "timeline", timelineId });
  }, [loroSync, stopFollowingAgent]);

  const attachTimelineFromNavigator = useCallback(
    (timeline: ProjectTimeline) => {
      stopFollowingAgent();
      const actionNodeId = `timeline-action-${Date.now().toString(36)}`;
      const result = loroSync.attachTimeline({
        timelineId: timeline.id,
        actionNodeId,
        position: { x: 100, y: 100 },
      });
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setWorkspaceSurface({ kind: "canvas", canvasId: activeCanvasId });
    },
    [activeCanvasId, loroSync, stopFollowingAgent],
  );

  const saveTimelineFromNavigator = useCallback(
    (timelineId: string, state: unknown) =>
      loroSync.applyTimelineState(timelineId, state),
    [loroSync.applyTimelineState],
  );

  const addProjectAssetToCanvas = useCallback(
    (asset: ProjectAsset, canvasId: string) => {
      const assetId = asset.assetId ?? asset.id;
      const label = asset.type === "video" ? "Project Video" : "Project Image";

      if (canvasId === activeCanvasId) {
        const nodeId = addNode(asset.type, { assetId, label, status: "completed" });
        if (nodeId) setWorkspaceSurface({ kind: "canvas", canvasId });
        return;
      }

      const targetNodes = loroSync.doc
        ? new Canvas(loroSync.doc, () => {}, canvasId).listNodes()
        : [];
      const rootNodes = targetNodes.filter((node) => !node.parent_id);
      const maxBottom = rootNodes.reduce((bottom, node) =>
        Math.max(bottom, node.position.y + (node.height ?? 300)), 0);
      const leftmost = rootNodes.reduce((left, node) =>
        Math.min(left, node.position.x), Number.POSITIVE_INFINITY);
      const nodeId = `asset-node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = loroSync.addNodeToCanvas(canvasId, nodeId, {
        id: nodeId,
        type: asset.type,
        data: { assetId, label, status: "completed" },
        position: {
          x: Number.isFinite(leftmost) ? leftmost : 100,
          y: maxBottom > 0 ? maxBottom + 50 : 100,
        },
      });
      if (created) selectCanvas(canvasId);
    },
    [activeCanvasId, addNode, loroSync, selectCanvas],
  );

  return (
    <ProjectProvider projectId={project.id}>
            <LoroSyncProvider loroSync={loroSync}>
              <CustomActionsProvider actions={customActions}>
              <PresenceAwarenessProvider peers={awareness.peers}>
              <ImageEditorProvider>
                <VideoClipperProvider>
                <VideoEditorProvider onOpenTimeline={openTimelineFromCanvasAction}>
                    <MediaViewerProvider>
                        <LayoutActionsProvider value={{ relayoutParent, ungroup }}>
                        <div
                            className="flex w-full flex-col bg-warm-page overflow-hidden"
                            style={{ height: 'var(--clash-project-editor-height, 100vh)' }}
                        >
                        {/* Hidden File Input */}
                        <Input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileChange}
                        />

                        {/* Top Toolbar */}


                        {/* Main Canvas Area */}
                        <div className="flex flex-1 overflow-hidden relative">
                            {/* Activity Toasts */}
                            <ActivityToast
                                toasts={toasts}
                                dismiss={dismissToast}
                                sidebarWidth={sidebarWidth}
                                isSidebarCollapsed={isSidebarCollapsed}
                            />

                            <div
                              id="project-workspace-shell"
                              data-copilot-layout={isCopilotDocked ? "docked" : "overlay"}
                              data-following-agent={followingAgent ? "true" : "false"}
                              data-project-navigator-collapsed={isProjectNavigatorCollapsed}
                              className="absolute inset-0 z-0 grid min-h-0 grid-cols-[12rem_minmax(0,1fr)] overflow-hidden transition-[grid-template-columns] duration-150 ease-out data-[project-navigator-collapsed=true]:grid-cols-[3rem_minmax(0,1fr)] [--clash-project-chrome-gutter:0.5rem] [--clash-project-control-height:2rem] [--clash-project-search-row-height:2.5rem] [--clash-project-sidebar-header-height:2.5rem]"
                              style={{ right: isCopilotDocked ? sidebarWidth : 0 }}
                            >
                            <ProjectWorkspaceNavigator
                              header={
                                <div
                                  id="editor-header"
                                  className="clash-project-sidebar-header-content flex min-w-0 flex-1 items-center gap-1.5 pointer-events-auto"
                                >
                                  <Tooltip label="Return to projects">
                                    <IconButton
                                      label="Return to projects"
                                      onClick={handleReturnToProjects}
                                      icon={<ArrowLeft className="h-4 w-4" weight="bold" />}
                                      size="sm"
                                      shape="rounded"
                                      className={`clash-project-return-button shrink-0 rounded-md text-slate-800 focus-visible:ring-offset-warm-page ${isProjectNavigatorCollapsed ? '' : '-ml-px'}`}
                                    />
                                  </Tooltip>
                                  {!isProjectNavigatorCollapsed ? (
                                    <form className="min-w-0 flex-1" onSubmit={handleProjectNameSubmit}>
                                      <Input
                                        ref={projectTitleInputRef}
                                        className="clash-project-name-input h-8 w-full min-w-0 bg-transparent px-1 font-display text-[13px] font-semibold text-slate-950 placeholder-stone-400 focus:outline-none focus:ring-0"
                                        value={projectName}
                                        onChange={(event) => setProjectName(event.target.value)}
                                        onBlur={() => {
                                          if (projectName !== project.name) {
                                            updateProjectName(project.id, projectName);
                                          }
                                        }}
                                        placeholder="Untitled"
                                      />
                                    </form>
                                  ) : null}
                                </div>
                              }
                              footer={<UserControls compact />}
                              collapsed={isProjectNavigatorCollapsed}
                              onCollapsedChange={setIsProjectNavigatorCollapsed}
                              canvases={loroSync.canvases}
                              timelines={loroSync.timelines}
                              assets={projectAssets}
                              assetCount={project.assetCount ?? projectAssets.length}
                              surface={workspaceSurface}
                              onSelectCanvas={selectCanvasFromNavigator}
                              onSelectTimeline={(timelineId) => {
                                stopFollowingAgent();
                                setWorkspaceSurface({
                                  kind: "timeline",
                                  timelineId,
                                });
                              }}
                              onSelectAssets={() => {
                                stopFollowingAgent();
                                setWorkspaceSurface({ kind: "assets" });
                              }}
                              onCreateCanvas={createCanvasFromNavigator}
                              onRenameCanvas={renameCanvasFromNavigator}
                              onDeleteCanvas={deleteCanvasFromNavigator}
                              onCreateTimeline={createTimelineFromNavigator}
                              onAttachTimeline={attachTimelineFromNavigator}
                            />

                            <div
                              id="project-workspace-inset"
                              className="relative min-h-0 min-w-0 overflow-hidden"
                            >
                            {workspaceSurface.kind === "assets" && (
                              <ProjectAssetsSurface
                                assets={projectAssets}
                                canvases={loroSync.canvases}
                                onAddToCanvas={addProjectAssetToCanvas}
                              />
                            )}

                            {selectedTimeline && (
                              <ProjectTimelineEditorSurface
                                timeline={selectedTimeline}
                                assets={projectAssets}
                                canvases={loroSync.canvases}
                                onSave={saveTimelineFromNavigator}
                                onOpenCanvas={selectCanvasFromNavigator}
                              />
                            )}

                            <div
                                ref={flowBoundsRef}
                                className={`absolute inset-0 z-0 ${workspaceSurface.kind === "canvas" ? "" : "hidden"} ${canvasMode === 'hand' ? '[&_.react-flow__pane]:cursor-grab [&_.react-flow__pane:active]:cursor-grabbing' : ''}`}
                            >
                                <ReactFlow
                                    nodes={sanitizedNodes}
                                    edges={edges}
                                    onInit={(instance) => {
                                        reactFlowInstanceRef.current = instance;
                                        window.requestAnimationFrame(focusPendingAgentTarget);
                                    }}
                                    onMoveStart={(event) => {
                                        if (event) stopFollowingAgent();
                                    }}
                                    onNodeClick={() => stopFollowingAgent()}
                                    onPaneClick={() => stopFollowingAgent()}
                                    onNodeDragStart={() => stopFollowingAgent()}
                                    onNodesChange={handleNodesChange}
                                    onEdgesChange={handleEdgesChange}
                                    onBeforeDelete={onBeforeDelete}
                                    onNodesDelete={onNodesDelete}
                                    onNodeDragStop={onNodeDragStop}
                                    onConnect={onConnect}
                                    onSelectionChange={onSelectionChange}
                                    onSelectionStart={() => {
                                        stopFollowingAgent();
                                        setIsMarqueeing(true);
                                    }}
                                    onSelectionEnd={() => setIsMarqueeing(false)}

                                    nodeTypes={nodeTypes}
                                    fitView
                                    onlyRenderVisibleElements
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
                                        flowBoundsRef={flowBoundsRef}
                                    />

                                    {/* Unix-pipe cascade dispatcher: adopts drafts on run
                                        request, propagates cascadeToken across stages. */}
                                    <CascadeRunnerMount
                                        nodes={nodes}
                                        edges={edges}
                                        setNodes={setNodes}
                                        customActions={customActions}
                                    />

                                </ReactFlow>
                            </div>

                            {/* Left Toolbar - Vertical Palette.
                                z-10 keeps it above the canvas (z-0) but well below
                                the bottom-right ChatbotCopilot popover and any modal
                                Dialog (z-[70]). */}
                            {workspaceSurface.kind === "canvas" && (
                              <motion.div
                                className="absolute left-[var(--clash-project-chrome-gutter)] top-[calc(var(--clash-project-sidebar-header-height)+var(--clash-project-search-row-height))] z-10 flex flex-col items-start gap-2 pointer-events-none"
                                initial={{ opacity: 0, x: -8, scale: 0.98 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                exit={{ opacity: 0, x: -8, scale: 0.98 }}
                                transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                            >
                                 <Toolbar.Root
                                    aria-label="Canvas tools"
                                    orientation="vertical"
                                    loop
                                    className="clash-canvas-toolbar-surface pointer-events-auto flex w-12 flex-col items-center gap-0 rounded-lg py-2 transition-colors"
                                 >
                                 <Toolbar.ToggleGroup
                                    type="single"
                                    value={canvasMode}
                                    onValueChange={(mode) => {
                                        if (mode === 'select' || mode === 'hand') setCanvasMode(mode);
                                    }}
                                    orientation="vertical"
                                    aria-label="Canvas mode"
                                    className="flex w-full flex-col items-center gap-0"
                                 >
                                    <Tooltip label="Select mode (V)">
                                        <Toolbar.ToggleItem value="select" asChild>
                                            <IconButton
                                                label="Select mode"
                                                icon={<CursorClick className="h-[18px] w-[18px]" weight="regular" />}
                                                size="sm"
                                                shape="rounded"
                                                className="rounded-md bg-transparent text-stone-500 hover:text-slate-950 data-[state=on]:bg-brand/10 data-[state=on]:text-brand"
                                            />
                                        </Toolbar.ToggleItem>
                                    </Tooltip>
                                    <Tooltip label="Hand mode (H)">
                                        <Toolbar.ToggleItem value="hand" asChild>
                                            <IconButton
                                                label="Hand mode"
                                                icon={<HandGrabbing className="h-[18px] w-[18px]" weight="regular" />}
                                                size="sm"
                                                shape="rounded"
                                                className="rounded-md bg-transparent text-stone-500 hover:text-slate-950 data-[state=on]:bg-brand/10 data-[state=on]:text-brand"
                                            />
                                        </Toolbar.ToggleItem>
                                    </Tooltip>
                                 </Toolbar.ToggleGroup>

                                 <div className="flex h-2 w-full shrink-0 items-center justify-center">
                                    <Toolbar.Separator
                                        orientation="horizontal"
                                        className="h-px w-8 bg-stone-200/80"
                                    />
                                 </div>

                                 <div className="flex w-full flex-none flex-col items-center gap-0">

                                    {toolbarMenu.map((item) => {
                                        const Icon = item.icon;
                                        const submenuItems = 'items' in item ? item.items : undefined;
                                        const sectionSpacing = item.id === 'actions' ? 'mt-2' : '';

                                        if (submenuItems) {
                                            return (
                                                <DropdownMenu key={item.id}>
                                                    <Tooltip label={item.label}>
                                                        <DropdownMenuTrigger asChild>
                                                            <Toolbar.Button asChild>
                                                                <IconButton
                                                                    label={item.label}
                                                                    icon={<Icon className="h-[18px] w-[18px]" weight="regular" />}
                                                                    size="sm"
                                                                    shape="rounded"
                                                                    className={`${sectionSpacing} clash-toolbar-button rounded-md bg-transparent text-stone-500 hover:text-slate-950 data-[state=open]:bg-brand/10 data-[state=open]:text-brand`}
                                                                />
                                                            </Toolbar.Button>
                                                        </DropdownMenuTrigger>
                                                    </Tooltip>
                                                    <DropdownMenuContent
                                                        aria-label={`${item.label} tools`}
                                                        side="right"
                                                        align="start"
                                                        sideOffset={10}
                                                        className="clash-canvas-menu-surface flex min-w-[140px] flex-col gap-0.5 rounded-lg p-1.5"
                                                    >
                                                        <div className="px-2 py-1 text-xs font-semibold text-stone-500">
                                                            {item.label}
                                                        </div>
                                                        {submenuItems.map((subItem) => {
                                                            const SubIcon = subItem.icon;
                                                            return (
                                                                <DropdownMenuItem
                                                                    key={subItem.id}
                                                                    onSelect={() => {
                                                                        handleToolClick(subItem.id);
                                                                    }}
                                                                    className="clash-input-icon-button gap-2.5 rounded-md px-2.5 py-2 text-sm text-stone-600 transition-colors hover:text-slate-950"
                                                                >
                                                                    <SubIcon className="h-4 w-4" />
                                                                    <span className="whitespace-nowrap">{subItem.label}</span>
                                                                </DropdownMenuItem>
                                                            );
                                                        })}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            );
                                        }

                                        return (
                                            <Tooltip key={item.id} label={item.label}>
                                                <Toolbar.Button asChild>
                                                    <IconButton
                                                        label={item.label}
                                                        icon={<Icon className="h-[18px] w-[18px]" weight="regular" />}
                                                        size="sm"
                                                        shape="rounded"
                                                        onClick={() => handleToolClick(item.id)}
                                                        className={`${sectionSpacing} clash-toolbar-button rounded-md bg-transparent text-stone-500 hover:text-slate-950`}
                                                    />
                                                </Toolbar.Button>
                                            </Tooltip>
                                        );
                                    })}

                                  </div>

                                  <div className="flex h-2 w-full shrink-0 items-center justify-center">
                                    <Toolbar.Separator
                                        orientation="horizontal"
                                        className="h-px w-8 bg-stone-200/80"
                                    />
                                  </div>

                                  <div className="flex w-full flex-none flex-col items-center gap-0">
                                    <Tooltip label="Auto Layout">
                                        <Toolbar.Button asChild>
                                            <IconButton
                                                 label="Auto Layout"
                                                 icon={<MagicWand className="h-[18px] w-[18px]" weight="regular" />}
                                                 onClick={onLayout}
                                                 size="sm"
                                                 shape="rounded"
                                                 className="clash-toolbar-button rounded-md bg-transparent text-stone-500 hover:text-slate-950"
                                             />
                                        </Toolbar.Button>
                                     </Tooltip>

                                     <Tooltip label="Undo">
                                         <Toolbar.Button asChild>
                                             <IconButton
                                                 label="Undo"
                                                 icon={<ArrowCounterClockwise className="h-[18px] w-[18px]" weight="bold" />}
                                                 onClick={() => loroSync.undo()}
                                                 disabled={!loroSync.canUndo}
                                                 size="sm"
                                                 shape="rounded"
                                                 className={`rounded-md ${
                                                     loroSync.canUndo
                                                     ? "clash-toolbar-button text-stone-500 hover:text-slate-950"
                                                     : "text-slate-300 cursor-not-allowed"
                                                 }`}
                                             />
                                         </Toolbar.Button>
                                     </Tooltip>
                                     <Tooltip label="Redo">
                                         <Toolbar.Button asChild>
                                             <IconButton
                                                 label="Redo"
                                                 icon={<ArrowClockwise className="h-[18px] w-[18px]" weight="bold" />}
                                                 onClick={() => loroSync.redo()}
                                                 disabled={!loroSync.canRedo}
                                                 size="sm"
                                                 shape="rounded"
                                                 className={`rounded-md ${
                                                     loroSync.canRedo
                                                     ? "clash-toolbar-button text-stone-500 hover:text-slate-950"
                                                     : "text-slate-300 cursor-not-allowed"
                                                 }`}
                                             />
                                         </Toolbar.Button>
                                     </Tooltip>
                                  </div>
                                 </Toolbar.Root>
                             </motion.div>
                            )}
                            </div>
                            </div>

                            <div
                                id="copilot-container"
                                className="fixed bottom-3 right-3 z-40 pointer-events-none"
                                style={{ top: 'calc(var(--clash-desktop-chrome-height, 0px) + 0.75rem)' }}
                            >
                                <div className="pointer-events-auto h-full">
                                    <ChatbotCopilot
                                        key={`${threadId || 'draft'}-${sessionKey}`}
                                        projectId={project.id}
                                        threadId={threadId}
                                        initialMessages={[]}
                                        onCommand={handleCommand}
                                        width={sidebarWidth}
                                        onWidthChange={setSidebarWidth}
                                        isCollapsed={isSidebarCollapsed}
                                        onCollapseChange={setIsSidebarCollapsed}
                                        layoutMode={workspaceSurface.kind === "canvas" ? "floating" : "docked"}
                                        followingAgent={followingAgent}
                                        onFollowingAgentChange={setFollowingAgentMode}
                                        onAgentCanvasTarget={recordAgentTarget}
                                        selectedNodes={selectedNodes}
                                        onAddNode={addNode}
                                        onRemoveNode={(nodeId, options) => {
                                            const currentNodes = nodesRef.current;
                                            if (!currentNodes.some((node) => node.id === nodeId)) return;
                                            if (!loroSync.removeNode(nodeId, options)) return;
                                            const nextNodes = currentNodes.filter((node) => node.id !== nodeId);
                                            nodesRef.current = nextNodes;
                                            setNodes(nextNodes);
                                        }}
                                        onAddEdge={(edge, options) => {
                                            if ('source' in edge && edge.source && edge.target) {
                                                const edgeId = 'id' in edge && typeof edge.id === 'string' && edge.id
                                                    ? edge.id
                                                    : `${edge.source}-${edge.target}`;
                                                const edgeWithDefaults = {
                                                    ...edge,
                                                    id: edgeId,
                                                    type: 'type' in edge && edge.type ? edge.type : 'default',
                                                };
                                                const currentEdges = edgesRef.current;
                                                if (currentEdges.some((existingEdge) => existingEdge.id === edgeId)) return;
                                                const nextEdges = addEdge(edgeWithDefaults as any, currentEdges);
                                                const addedEdge = nextEdges.find((candidate) => candidate.id === edgeId);
                                                if (addedEdge && !loroSync.addEdge(addedEdge.id, addedEdge, options)) return;
                                                edgesRef.current = nextEdges;
                                                setEdges(nextEdges);
                                            }
                                        }}
                                        onUpdateEdge={(edgeId, patch, options) => {
                                            const currentEdges = edgesRef.current;
                                            if (!currentEdges.some((edge) => edge.id === edgeId)) return;
                                            if (!loroSync.updateEdge(edgeId, patch, options)) return;
                                            const nextEdges = currentEdges.map((edge) =>
                                                edge.id === edgeId ? { ...edge, ...patch } : edge
                                            );
                                            edgesRef.current = nextEdges;
                                            setEdges(nextEdges);
                                        }}
                                        onRemoveEdge={(edgeId, options) => {
                                            const currentEdges = edgesRef.current;
                                            if (!currentEdges.some((edge) => edge.id === edgeId)) return;
                                            if (!loroSync.removeEdge(edgeId, options)) return;
                                            const nextEdges = currentEdges.filter((edge) => edge.id !== edgeId);
                                            edgesRef.current = nextEdges;
                                            setEdges(nextEdges);
                                        }}
                                        onApplyTimeline={(nodeId, timelineDsl, options) => {
                                            if (!loroSync.applyTimelineDsl(nodeId, timelineDsl, options)) return;
                                            setNodes((nds) => nds.map((node) =>
                                        node.id === nodeId
                                                    ? {
                                                        ...node,
                                                        data: {
                                                            ...(node.data || {}),
                                                            timelineDsl,
                                                        },
                                                    }
                                                    : node
                                            ));
                                        }}
                                        onUpdateNode={updateNode}
                                        findNodeIdByName={findNodeIdByName}
                                        nodes={nodes}
                                        edges={edges}
                                        initialPrompt={chatInitialPrompt}
                                        sessionHistory={sessionHistory}
                                        onNewSession={handleNewSession}
                                        onSwitchSession={handleSwitchSession}
                                        onDeleteSession={handleDeleteSession}
                                        onUpsertSession={upsertSession}
                                        onCreateSession={handleCopilotCreateSession}
                                        actorUserId={project.ownerId}
                                    />
                                </div>
                            </div>
                        </div>
                        </div>
                        </LayoutActionsProvider>
                    </MediaViewerProvider>
                </VideoEditorProvider>
                </VideoClipperProvider>
              </ImageEditorProvider>
              </PresenceAwarenessProvider>
              </CustomActionsProvider>
            </LoroSyncProvider>
        </ProjectProvider >
    );
}
