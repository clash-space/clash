
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretLeft, CaretRight, Plus, ClockCounterClockwise, Trash, Plug } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { Command } from '@clash/web-ui/lib/clientActions';
import { UserMessage } from './copilot/UserMessage';
import { AgentCard, type AgentLog } from './copilot/AgentCard';
import { ToolCall } from './copilot/ToolCall';
import { ApprovalCard } from './copilot/ApprovalCard';
import { ThinkingProcess } from './copilot/ThinkingProcess';
import { ChatInput } from './copilot/ChatInput';
import { TodoList, TodoItem } from './copilot/TodoList';
import { ThinkingIndicator } from './copilot/ThinkingIndicator';
import { MessageErrorBoundary } from './copilot/MessageErrorBoundary';
import { ByoAgentDialog } from './copilot/ByoAgentDialog';
import { useAgentByoBridge } from '@clash/web-ui/hooks/useAgentByoBridge';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { useAsset, getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { useAgentCopilot, type CustomEvent } from '@clash/web-ui/hooks/useAgentCopilot';


interface Message {
    id: string;
    content: string;
    role: string;
    projectId: string;
    createdAt: Date;
}

interface ChatbotCopilotProps {
    projectId: string;
    threadId: string;
    initialMessages: Message[];
    onCommand?: (command: Command) => void;
    width: number;
    onWidthChange: (width: number) => void;
    isCollapsed: boolean;
    onCollapseChange: (collapsed: boolean) => void;
    selectedNodes?: RFNode[];
    onAddNode?: (type: string, extraData?: any) => string;
    onAddEdge?: (params: RFEdge | RFConnection) => void;
    onUpdateNode?: (nodeId: string, updates: Partial<RFNode>) => void;
    findNodeIdByName?: (name: string) => string | undefined;
    nodes?: RFNode[];
    edges?: RFEdge[];
    initialPrompt?: string;
    /** Session history + actions passed from parent */
    sessionHistory?: Array<{ threadId: string; title?: string }>;
    onNewSession?: () => void;
    onSwitchSession?: (threadId: string) => void;
    onDeleteSession?: (threadId: string) => void;
    /** Called when user sends first message with no active session */
    onCreateSession?: (initialMessage: string) => void;
    /** Create canvas nodes from already-uploaded attachments */
    onUploadFiles?: (attachments: import('./copilot/ChatInput').UploadedAttachment[]) => void;
}

/** Markdown components for assistant text rendering */
const markdownComponents = {
    p: ({ children }: any) => <p className="mb-4 last:mb-0">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc pl-4 mb-4 space-y-1">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-4 space-y-1">{children}</ol>,
    li: ({ children }: any) => <li className="mb-1">{children}</li>,
    h1: ({ children }: any) => <h1 className="font-display text-2xl font-bold mb-4 mt-6">{children}</h1>,
    h2: ({ children }: any) => <h2 className="font-display text-xl font-bold mb-3 mt-5">{children}</h2>,
    h3: ({ children }: any) => <h3 className="font-display text-lg font-bold mb-2 mt-4">{children}</h3>,
    code: ({ className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const isInline = !match && !String(children).includes('\n');
        return isInline ? (
            <code className="bg-warm-muted px-1.5 py-0.5 rounded text-sm font-mono text-[#d94f38] border border-warm-border" {...props}>
                {children}
            </code>
        ) : (
            <code className="block bg-slate-900 text-slate-50 p-4 rounded-lg mb-4 overflow-x-auto text-sm font-mono" {...props}>
                {children}
            </code>
        );
    },
    pre: ({ children }: any) => <pre className="not-prose mb-4">{children}</pre>,
    blockquote: ({ children }: any) => <blockquote className="border-l-4 border-warm-border pl-4 italic text-stone-500 mb-4">{children}</blockquote>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>,
};

/** Thumbnail for a selected node — resolves media via the asset row.
 *  Images show srcR2Key, videos show coverR2Key. Nodes without an assetId
 *  (drafts, text) render an empty tile. */
function SelectedNodeThumbnail({ node }: { node: RFNode }) {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = typeof data.assetId === 'string' ? data.assetId : undefined;
    const asset = useAsset(assetId);
    const isVideo = node.type === 'video' || data.actionType === 'video-gen';
    const r2Key = isVideo ? (asset?.coverR2Key ?? asset?.srcR2Key) : asset?.srcR2Key;
    const signedUrl = useSignedUrl(r2Key ?? undefined);
    return (
        <div className="w-6 h-6 rounded-md ring-2 ring-white overflow-hidden bg-slate-100 flex items-center justify-center">
            {isVideo && asset?.srcR2Key && !asset?.coverR2Key && signedUrl ? (
                // video without a cover yet — show the video element, first frame
                <video
                    src={`${signedUrl}#t=0.1`}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    muted
                    playsInline
                />
            ) : signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={signedUrl} alt="" className="w-full h-full object-cover" />
            ) : null}
        </div>
    );
}

export default function ChatbotCopilot({
    projectId,
    threadId,
    initialMessages,
    onCommand: _onCommand,
    width,
    onWidthChange,
    isCollapsed,
    onCollapseChange,
    selectedNodes = [],
    onAddNode: _onAddNode,
    onAddEdge: _onAddEdge,
    onUpdateNode,
    findNodeIdByName: _findNodeIdByName,
    nodes = [],
    edges: _edges = [],
    initialPrompt,
    sessionHistory = [],
    onNewSession,
    onSwitchSession,
    onDeleteSession,
    onCreateSession,
    onUploadFiles,
}: ChatbotCopilotProps) {
    // ─── UI State ──────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [isResizing, setIsResizing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
    const [suggestions, setSuggestions] = useState<Array<{ label: string; message: string }>>([]);

    // Three transports coexist:
    //   - 'cloud'   : useAgentCopilot (cloud LLM, default)
    //   - 'byo'     : useAgentByoBridge (one-shot pair token, ad-hoc local)
    //   - 'runtime' : useClashRuntime  (persistent daemon registered via setup)
    // The picker (Plug button → menu) sets `chatMode`; the picked hook drives
    // input + message render. Switching transports doesn't touch the others.
    const [chatMode, setChatMode] = useState<'cloud' | 'byo' | 'runtime'>('cloud');
    const [byoDialogOpen, setByoDialogOpen] = useState(false);
    const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
    const [addMachineOpen, setAddMachineOpen] = useState(false);
    const byo = useAgentByoBridge();
    const clashRt = useClashRuntime();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
    const historyDropdownRef = useRef<HTMLDivElement | null>(null);
    const historyButtonRef = useRef<HTMLButtonElement | null>(null);

    // ─── Agent Chat Hook ─────────────────────────────────────
    const {
        messages,
        sendMessage,
        stop,
        status,
        clearHistory,
        connected,
        connectionError,
        lastFailedMessage,
        clearConnectionError,
        customEvents,
        clearCustomEvents,
        queueMessageOnOpen,
    } = useAgentCopilot({
        projectId,
        threadId,
        onCustomEvent: useCallback((data: Record<string, unknown>) => {
            if (data.type === 'suggestions' && Array.isArray(data.suggestions)) {
                setSuggestions(data.suggestions as Array<{ label: string; message: string }>);
            }
        }, []),
    });

    const cloudIsProcessing = status === 'submitted' || status === 'streaming';
    // Auto-switch into BYO mode the first time a bridge connects, and back
    // to cloud when it drops. Explicit shutdown via the header button also
    // resets here. Keeps the modes from drifting out of sync silently.
    useEffect(() => {
        if (chatMode === 'cloud' && byo.status === 'connected') setChatMode('byo');
        if (chatMode === 'byo' && byo.status === 'disconnected') setChatMode('cloud');
    }, [byo.status, chatMode]);
    // Same idea for runtime mode: drop back to cloud if the WS dies.
    useEffect(() => {
        if (chatMode === 'runtime' && (clashRt.status === 'disconnected' || clashRt.status === 'idle')) {
            // Don't reset on 'idle' if it's the *initial* idle (no select yet);
            // we only want this on transition away from a working session.
            if (clashRt.status === 'disconnected') setChatMode('cloud');
        }
    }, [clashRt.status, chatMode]);

    const byoIsProcessing = byo.status === 'sending' || byo.status === 'streaming';
    const runtimeIsProcessing = clashRt.status === 'connecting' || clashRt.status === 'sending' || clashRt.status === 'streaming';
    const isProcessing =
        chatMode === 'byo' ? byoIsProcessing :
        chatMode === 'runtime' ? runtimeIsProcessing :
        cloudIsProcessing;

    // Mount-time send of the pending first message. Parent gives us a fresh
    // `key={threadId}` whenever the session changes, so this component remounts
    // cleanly on every session change — no useChat id-transition race, no
    // module-level pending state. queueMessageOnOpen waits for the WS handshake
    // to land before firing; subsequent sends just hit `sendMessage` directly.
    const initialMessageRef = useRef(initialPrompt);
    useEffect(() => {
        const msg = initialMessageRef.current;
        if (msg && threadId) queueMessageOnOpen(msg);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cover the gap between mount and the first send actually firing. During
    // that ~300-800ms window (POST settled but WS still handshaking,
    // queueMessageOnOpen waiting for `connected`), `status` is still 'ready'
    // and `isCreatingSession` has flipped back to false — so without this
    // flag ChatInput briefly shows the idle "arrow" submit button, which
    // looks like nothing is happening. Cleared as soon as the first message
    // shows up in the array (sendMessage's optimistic insert), at which point
    // status takes over → 'submitted' → 'streaming'.
    const [waitingFirstSend, setWaitingFirstSend] = useState(!!initialPrompt);
    useEffect(() => {
        if (waitingFirstSend && messages.length > 0) setWaitingFirstSend(false);
    }, [messages.length, waitingFirstSend]);

    // Auto-restore failed message to input
    useEffect(() => {
        if (lastFailedMessage && !input) {
            setInput(lastFailedMessage);
        }
    }, [lastFailedMessage]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Session Actions (delegated to parent) ───────────────
    const handleNewSession = useCallback(() => {
        setTodoItems([]);
        clearCustomEvents();
        onNewSession?.();
    }, [clearCustomEvents, onNewSession]);

    const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onDeleteSession?.(id);
    }, [onDeleteSession]);

    const handleStop = async () => {
        if (chatMode === 'runtime') {
            clashRt.cancel();
            return;
        }
        if (chatMode === 'byo') {
            byo.cancel();
            return;
        }
        await stop();
    };

    const handleHistoryClick = () => {
        setShowHistory(prev => !prev);
    };

    // Close history dropdown on outside click
    useEffect(() => {
        if (!showHistory) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as globalThis.Node | null;
            if (!target) return;
            if (historyDropdownRef.current?.contains(target)) return;
            if (historyButtonRef.current?.contains(target)) return;
            setShowHistory(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowHistory(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showHistory]);

    // ─── Scroll ──────────────────────────────────────────────
    const scrollToBottom = useCallback(() => {
        if (!shouldStickToBottom) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [shouldStickToBottom]);

    const handleScroll = () => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShouldStickToBottom(distanceToBottom < 120);
    };

    useEffect(() => {
        scrollToBottom();
    }, [isCollapsed, messages, shouldStickToBottom, scrollToBottom]);

    // ─── @-mention nodes for ChatInput ────────────────────────
    // `thumbnail` decides whether the mention renders as an inline image chip:
    //   - image nodes  → asset.srcR2Key (the image itself)
    //   - video nodes  → asset.coverR2Key (persisted cover)
    //   - text / no asset → plain text mention
    // Resolving assets is async (getAsset hits /api/v1/assets/:id); we stash
    // the results in a Map keyed by nodeId and populate it lazily. Nodes
    // without a resolved asset yet render as text-only mentions, which is
    // the same outcome as "no thumbnail" used to be.
    const [assetThumbsByNodeId, setAssetThumbsByNodeId] = useState<Map<string, string>>(
        () => new Map(),
    );
    useEffect(() => {
        if (!nodes) return;
        let cancelled = false;
        (async () => {
            const next = new Map<string, string>();
            for (const n of nodes) {
                if (!['image', 'video'].includes(n.type as string)) continue;
                const assetId = typeof n.data?.assetId === 'string' ? n.data.assetId : undefined;
                if (!assetId) continue;
                try {
                    const asset = await getAsset(assetId);
                    const r2Key = n.type === 'video'
                        ? (asset.coverR2Key ?? asset.srcR2Key)
                        : asset.srcR2Key;
                    if (r2Key) next.set(n.id, r2Key);
                } catch {
                    // asset not yet available; skip
                }
            }
            if (cancelled) return;
            // Skip the setState when contents are equal — the previous version
            // always handed in a *new* Map identity, which made `mentionableNodes`
            // (useMemo deps include this Map) recompute on every nodes change
            // even when nothing meaningful moved. New array identity then forced
            // child renders down through ReactMarkdown / hook-heavy thumbnails,
            // which made render-time setState chains in those subtrees easy to
            // tip into "Maximum update depth exceeded" (React #185).
            setAssetThumbsByNodeId((prev) => {
                if (prev.size === next.size) {
                    let same = true;
                    for (const [k, v] of next) {
                        if (prev.get(k) !== v) { same = false; break; }
                    }
                    if (same) return prev;
                }
                return next;
            });
        })();
        return () => { cancelled = true; };
    }, [nodes]);

    const mentionableNodes = useMemo(() => {
        if (!nodes) return [];
        return nodes
            .filter((n) => ['image', 'video', 'text'].includes(n.type as string))
            .map((n) => ({
                id: n.id,
                type: n.type as string,
                label: (n.data.label as string) || n.id,
                thumbnail: assetThumbsByNodeId.get(n.id),
            }));
    }, [nodes, assetThumbsByNodeId]);

    // ─── Submit ──────────────────────────────────────────────
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [sessionError, setSessionError] = useState<string | null>(null);

    const handleSubmit = async (text: string, attachments: import('./copilot/ChatInput').UploadedAttachment[] = []) => {
        const value = text.trim();
        if (!value && attachments.length === 0) return;
        if (isProcessing || isCreatingSession) return;
        setInput('');
        setSuggestions([]);
        setSessionError(null);
        clearConnectionError();
        setShouldStickToBottom(true);

        // BYO mode: skip session/upload plumbing — local agents don't have
        // a clash thread or asset upload pipeline. Just route the prompt.
        if (chatMode === 'byo') {
            byo.sendMessage(value);
            return;
        }
        // Persistent-runtime mode: same shape (raw prompt, daemon handles it).
        if (chatMode === 'runtime') {
            clashRt.sendMessage(value);
            return;
        }

        // Create canvas nodes for uploaded attachments
        if (attachments.length > 0 && onUploadFiles) {
            onUploadFiles(attachments);
        }

        // Message text is already markdown with inline images: ![name](storageKey)
        // The agent can parse these directly
        const msgText = value;

        if (!threadId) {
            setIsCreatingSession(true);
            try {
                await onCreateSession?.(msgText);
            } catch {
                setSessionError('Failed to create session. Please try again.');
                setInput(value);
            } finally {
                setIsCreatingSession(false);
            }
        } else {
            try {
                await sendMessage({ text: msgText });
            } catch {
                setInput(value);
            }
        }
    };

    // Strip the ?prompt= query param after first use so a manual reload
    // doesn't re-send the original landing prompt.
    useEffect(() => {
        if (initialPrompt && window.location.search.includes('prompt=')) {
            window.history.replaceState({}, '', window.location.pathname);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── Resize ──────────────────────────────────────────────
    const startResizing = () => setIsResizing(true);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            e.preventDefault();
            const newWidth = window.innerWidth - e.clientX;
            onWidthChange(Math.max(300, Math.min(700, newWidth)));
        };
        const handleMouseUp = () => {
            setIsResizing(false);
            document.body.style.userSelect = 'auto';
        };
        if (isResizing) {
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, onWidthChange]);

    // ─── Render ──────────────────────────────────────────────
    return (
        <>
            <AnimatePresence>
                {isCollapsed && (
                    <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => onCollapseChange(false)}
                        className="absolute right-4 top-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-warm-border bg-warm-surface/85 shadow-sm backdrop-blur-xl transition-all hover:shadow-md hover:bg-white"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                    </motion.button>
                )}
            </AnimatePresence>

            <motion.div
                className={`h-full bg-warm-surface/85 backdrop-blur-xl flex flex-col relative ${isCollapsed ? '' : 'border-l border-warm-border shadow-xl'}`}
                style={{ width: isCollapsed ? 0 : `${width}px` }}
                animate={{ width: isCollapsed ? 0 : width }}
                transition={isResizing ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
            >
                {!isCollapsed && (
                    <div
                        onMouseDown={startResizing}
                        className={`absolute left-0 top-0 bottom-0 w-0.5 cursor-ew-resize transition-colors z-10 ${isResizing ? 'bg-red-500' : 'hover:bg-red-500 bg-red-500/0'}`}
                    />
                )}

                {!isCollapsed && (
                    <>
                        <motion.button
                            onClick={() => onCollapseChange(true)}
                            className="absolute left-2 top-4 z-20 p-2 flex items-center justify-center hover:bg-warm-muted rounded-full transition-all"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <CaretRight className="w-5 h-5 text-stone-600" weight="bold" />
                        </motion.button>

                        {/* Session Controls */}
                        <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
                            <motion.button
                                onClick={handleNewSession}
                                className="p-2 rounded-full hover:bg-warm-muted text-slate-700 transition-colors"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                title="New Session"
                            >
                                <Plus className="w-5 h-5" weight="bold" />
                            </motion.button>
                            <motion.button
                                onClick={handleHistoryClick}
                                ref={historyButtonRef}
                                className="p-2 rounded-full hover:bg-warm-muted text-slate-700 transition-colors relative"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                title="History"
                            >
                                <ClockCounterClockwise className="w-5 h-5" weight="bold" />
                                {sessionHistory.length > 0 && (
                                    <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white" />
                                )}
                            </motion.button>
                            {/* "Run on:" picker.
                                Click → menu with Cloud + each registered runtime + ad-hoc options.
                                Plug is filled green when something other than Cloud is active. */}
                            <div className="relative">
                                <motion.button
                                    onClick={() => {
                                        // Refresh the runtime list each time the menu opens
                                        // so users don't see a stale offline marker right
                                        // after starting their daemon.
                                        if (!runtimeMenuOpen) void clashRt.refresh();
                                        setRuntimeMenuOpen((v) => !v);
                                    }}
                                    className={`p-2 rounded-full transition-colors ${
                                        chatMode !== 'cloud'
                                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                            : 'hover:bg-warm-muted text-slate-700'
                                    }`}
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    title="Run on (Cloud / local runtime)"
                                >
                                    <Plug className="w-5 h-5" weight="bold" />
                                </motion.button>
                                <AnimatePresence>
                                    {runtimeMenuOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
                                            className="absolute top-11 right-0 z-30 w-72 bg-warm-surface rounded-xl shadow-xl border border-warm-border overflow-hidden"
                                        >
                                            <div className="px-3 py-2 border-b border-warm-border bg-warm-muted">
                                                <div className="font-display text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Run on</div>
                                            </div>
                                            <div className="py-1">
                                                <RuntimeMenuRow
                                                    label="Cloud"
                                                    sub="Default — clash.video LLMs"
                                                    active={chatMode === 'cloud'}
                                                    onClick={() => {
                                                        if (chatMode === 'byo') byo.shutdown();
                                                        if (chatMode === 'runtime') clashRt.shutdown();
                                                        setChatMode('cloud');
                                                        setRuntimeMenuOpen(false);
                                                    }}
                                                />
                                                {clashRt.runtimes.length > 0 && (
                                                    <div className="px-3 pt-1 pb-0.5 text-[10px] text-stone-400 uppercase tracking-wider">My machines</div>
                                                )}
                                                {clashRt.runtimes.map((rt) => {
                                                    const online = rt.status === 'online';
                                                    return (
                                                        <RuntimeMenuRow
                                                            key={rt.id}
                                                            label={rt.hostname || rt.machine_id.slice(0, 10)}
                                                            sub={online ? `online · ${rt.agents.length} agent${rt.agents.length === 1 ? '' : 's'}` : 'offline'}
                                                            active={chatMode === 'runtime' && clashRt.selectedRuntimeId === rt.id}
                                                            disabled={!online || rt.agents.length === 0}
                                                            onClick={async () => {
                                                                if (chatMode === 'byo') byo.shutdown();
                                                                setRuntimeMenuOpen(false);
                                                                setChatMode('runtime');
                                                                await clashRt.select(rt.id);
                                                            }}
                                                        />
                                                    );
                                                })}
                                                <div className="border-t border-warm-border/70 my-1" />
                                                <RuntimeMenuRow
                                                    label="Quick connect…"
                                                    sub="One-shot npx pairing (no install)"
                                                    onClick={() => {
                                                        setRuntimeMenuOpen(false);
                                                        setByoDialogOpen(true);
                                                    }}
                                                />
                                                <RuntimeMenuRow
                                                    label="Add machine…"
                                                    sub="Register a persistent local runtime"
                                                    onClick={() => {
                                                        setRuntimeMenuOpen(false);
                                                        setAddMachineOpen(true);
                                                    }}
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* History Dropdown */}
                        <AnimatePresence>
                            {showHistory && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                    ref={historyDropdownRef}
                                    className="absolute top-14 right-4 z-30 w-64 bg-warm-surface rounded-xl shadow-xl border border-warm-border overflow-hidden"
                                >
                                    <div className="p-3 border-b border-warm-border bg-warm-muted">
                                        <h3 className="font-display text-xs font-semibold text-stone-500 uppercase tracking-wider">Session History</h3>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {sessionHistory.length === 0 ? (
                                            <div className="p-4 text-center text-sm text-slate-400">No history yet</div>
                                        ) : (
                                            sessionHistory.map((item, index) => (
                                                <div
                                                    key={item.threadId}
                                                    className="px-4 py-3 hover:bg-warm-muted cursor-pointer border-b border-warm-border/70 last:border-0 flex items-center justify-between group"
                                                    onClick={() => {
                                                        onSwitchSession?.(item.threadId);
                                                        setShowHistory(false);
                                                    }}
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]">
                                                            {item.title || `Session ${index + 1}`}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-mono">{item.threadId.slice(-6)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <motion.button
                                                            onClick={(e) => deleteSession(item.threadId, e)}
                                                            className="p-1.5 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            title="Delete Session"
                                                        >
                                                            <Trash className="w-3.5 h-3.5" />
                                                        </motion.button>
                                                        <CaretRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500" />
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                )}

                <AnimatePresence>
                    {!isCollapsed && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full flex flex-col pt-16 relative"
                        >
                            <div
                                ref={scrollContainerRef}
                                onScroll={handleScroll}
                                className="absolute inset-0 top-16 overflow-y-auto px-6 pt-4 pb-32"
                            >
                                <div className="space-y-6">
                                    {/* BYO + runtime modes both produce ByoMessage[]; same renderer.
                                        Cloud renders the heavier UIMessage path. */}
                                    {chatMode === 'byo' && (
                                        <ByoMessageList messages={byo.messages} />
                                    )}
                                    {chatMode === 'runtime' && (
                                        <>
                                            {clashRt.status === 'connecting' && (
                                                <div className="text-xs text-stone-400 italic">Connecting to runtime…</div>
                                            )}
                                            {clashRt.errorMessage && (
                                                <div className="text-sm text-red-600">⚠ {clashRt.errorMessage}</div>
                                            )}
                                            <ByoMessageList messages={clashRt.messages} />
                                        </>
                                    )}
                                    {chatMode === 'cloud' && (
                                    <>
                                    {/* Render messages from useAgentChat */}
                                    {messages.map((msg: any) => (
                                        <motion.div
                                            key={msg.id}
                                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        >
                                            <MessageErrorBoundary messageId={msg.id}>
                                            {msg.role === 'user' ? (
                                                <UserMessage
                                                    content={
                                                        msg.parts
                                                            ?.filter((p: any) => p.type === 'text')
                                                            .map((p: any) => p.text)
                                                            .join('') || ''
                                                    }
                                                    mentionNodes={mentionableNodes}
                                                />
                                            ) : (
                                                <div className="space-y-3">
                                                    {msg.parts?.map((part: any, i: number) => {
                                                        if (part.type === 'text' && part.text) {
                                                            return (
                                                                <div key={i} className="text-base text-slate-800 leading-relaxed px-1 font-medium">
                                                                    <ReactMarkdown components={markdownComponents}>
                                                                        {part.text}
                                                                    </ReactMarkdown>
                                                                </div>
                                                            );
                                                        }
                                                        if (part.type === 'reasoning') {
                                                            return <ThinkingProcess key={i} content={part.text} />;
                                                        }
                                                        if (part.type === 'step-start') {
                                                            return <div key={i} className="border-t border-slate-100 my-2" />;
                                                        }
                                                        // Tool calls (both static and dynamic)
                                                        if (part.type?.startsWith('tool-') || part.type === 'dynamic-tool') {
                                                            const toolName = part.type === 'dynamic-tool'
                                                                ? part.toolName
                                                                : part.type.replace('tool-', '');

                                                            // Sub-agent delegation: show AgentCard for preliminary outputs
                                                            if (toolName === 'task_delegation' && part.preliminary && part.output) {
                                                                const progress = part.output as any;
                                                                const agentName = progress.agent || 'Agent';
                                                                const agentLogs: AgentLog[] = [];

                                                                if (progress.toolCalls?.length) {
                                                                    progress.toolCalls.forEach((tc: any) => {
                                                                        // Support both old format (string) and new format (SubAgentToolCall)
                                                                        if (typeof tc === 'string') {
                                                                            agentLogs.push({ id: `tc-${tc}`, type: 'text', content: `→ ${tc}` });
                                                                        } else {
                                                                            agentLogs.push({
                                                                                id: tc.id || `tc-${tc.toolName}`,
                                                                                type: 'tool_call',
                                                                                toolProps: {
                                                                                    toolName: tc.toolName,
                                                                                    args: tc.args,
                                                                                    result: tc.output,
                                                                                    status: tc.status === 'completed' ? 'success'
                                                                                        : tc.status === 'error' ? 'error'
                                                                                        : 'pending',
                                                                                    indent: false,
                                                                                },
                                                                            });
                                                                        }
                                                                    });
                                                                }
                                                                if (progress.text) {
                                                                    agentLogs.push({ id: 'text', type: 'text', content: progress.text });
                                                                }
                                                                if (progress.message) {
                                                                    agentLogs.push({ id: 'msg', type: 'text', content: progress.message });
                                                                }

                                                                const personaMap: Record<string, string> = {
                                                                    ScriptWriter: 'scriptwriter',
                                                                    ConceptArtist: 'conceptartist',
                                                                    StoryboardDesigner: 'storyboardartist',
                                                                    Editor: 'videoproducer',
                                                                };

                                                                return (
                                                                    <AgentCard
                                                                        key={part.toolCallId || i}
                                                                        agentName={agentName}
                                                                        status={progress.status === 'completed' ? 'done' : progress.status === 'failed' ? 'failed' : 'working'}
                                                                        logs={agentLogs}
                                                                        persona={(personaMap[agentName] || 'default') as any}
                                                                    />
                                                                );
                                                            }

                                                            const toolStatus = part.state === 'output-available' ? 'success'
                                                                : part.state === 'output-error' ? 'error'
                                                                : part.state === 'approval-requested' ? 'pending'
                                                                : 'pending' as const;
                                                            return (
                                                                <ToolCall
                                                                    key={part.toolCallId || i}
                                                                    toolName={toolName}
                                                                    args={part.input}
                                                                    result={part.output}
                                                                    status={toolStatus}
                                                                />
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                                </div>
                                            )}
                                            </MessageErrorBoundary>
                                        </motion.div>
                                    ))}
                                    </>
                                    )}

                                    {isProcessing && (
                                        <ThinkingIndicator message={status === 'submitted' ? 'Thinking' : 'Streaming'} />
                                    )}

                                    {/* Suggestion chips (e.g. "Continue" after step limit) */}
                                    {suggestions.length > 0 && !isProcessing && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="flex flex-wrap gap-2 px-1"
                                        >
                                            {suggestions.map((s, i) => (
                                                <motion.button
                                                    key={i}
                                                    onClick={() => handleSubmit(s.message)}
                                                    className="px-4 py-2 text-sm font-medium text-slate-800 bg-warm-surface border border-warm-border rounded-full shadow-sm hover:bg-white hover:border-brand/30 transition-all"
                                                    whileHover={{ scale: 1.03, y: -1 }}
                                                    whileTap={{ scale: 0.97 }}
                                                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                                >
                                                    {s.label}
                                                </motion.button>
                                            ))}
                                        </motion.div>
                                    )}

                                    <div ref={messagesEndRef} />
                                </div>
                            </div>

                            {/* Selected Context Badge */}
                            <AnimatePresence>
                                {selectedNodes.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                        className="absolute bottom-[80px] right-6 z-20 pointer-events-auto"
                                    >
                                        <div className="bg-warm-surface/90 backdrop-blur-md text-slate-700 text-xs font-medium px-3 py-1.5 rounded-full border border-warm-border shadow-sm flex items-center gap-2">
                                            <div className="flex -space-x-2">
                                                {selectedNodes.filter(n => !!n.data?.assetId).slice(0, 3).map((node) => (
                                                    <SelectedNodeThumbnail key={node.id} node={node} />
                                                ))}
                                            </div>
                                            <span>{selectedNodes.length} Selected</span>
                                            {selectedNodes.length === 1 && (
                                                <span className="text-stone-400 border-l border-warm-border pl-2 max-w-[100px] truncate">
                                                    {(typeof selectedNodes[0].data?.label === 'string' ? selectedNodes[0].data.label : undefined) || selectedNodes[0].type}
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Todo List Overlay */}
                            <AnimatePresence>
                                {todoItems.length > 0 && (
                                    <TodoList items={todoItems} />
                                )}
                            </AnimatePresence>

                            <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-warm-page via-warm-page/85 to-transparent pointer-events-none" />

                            <div className="absolute bottom-0 left-0 right-0">
                                <ChatInput
                                    input={input}
                                    onInputChange={setInput}
                                    onSubmit={handleSubmit}
                                    onStop={handleStop}
                                    isProcessing={isProcessing}
                                    isCreatingSession={isCreatingSession || waitingFirstSend}
                                    connected={connected}
                                    error={sessionError || connectionError}
                                    onDismissError={() => { setSessionError(null); clearConnectionError(); }}
                                    placeholder={selectedNodes.length > 0 ? 'Ask anything about selected files...' : 'Ask anything...'}
                                    mentionableNodes={mentionableNodes}
                                    projectId={projectId}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            {/* BYO pairing dialog. Lives at the panel level rather than inside
                the chat scroll area so it overlays correctly. */}
            <ByoAgentDialog
                open={byoDialogOpen}
                status={byo.status}
                pairTokenDisplay={byo.pairTokenDisplay}
                errorMessage={byo.errorMessage}
                onStartPairing={byo.startPairing}
                onClose={() => setByoDialogOpen(false)}
            />
            <AddMachineDialog open={addMachineOpen} onClose={() => setAddMachineOpen(false)} />
        </>
    );
}

/**
 * AddMachineDialog — shows the npx setup command. The actual OAuth
 * exchange happens when the user runs that command in their terminal —
 * the CLI binds a localhost callback and opens /connect-daemon with
 * cb + state params (which is why opening /connect-daemon directly is
 * useless; this dialog is the right entry point).
 */
function AddMachineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const cmd = 'npx @clash-space/bridge@beta setup';
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* no clipboard access; user can select-all */ }
    };
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="relative w-[560px] max-w-[92vw] rounded-2xl bg-warm-surface border border-warm-border shadow-xl p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="font-display text-lg font-bold text-slate-800 mb-1">
                            Register a machine
                        </h2>
                        <p className="text-sm text-stone-500 mb-5">
                            On the computer you want to use, run this in a terminal. It opens
                            your browser, asks you to allow the connection, then installs a
                            background daemon. After that, the machine appears in the "Run on"
                            menu — automatically and persistently.
                        </p>
                        <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">
                            Run this in your terminal
                        </div>
                        <div className="flex items-stretch gap-2 mb-3">
                            <code className="flex-1 font-mono text-sm bg-slate-900 text-slate-50 px-3 py-2.5 rounded-lg break-all select-all">
                                {cmd}
                            </code>
                            <button
                                type="button"
                                onClick={onCopy}
                                className="px-3 rounded-lg bg-warm-muted hover:bg-warm-border text-slate-700 transition-colors text-sm font-medium"
                            >
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <p className="text-xs text-stone-400 leading-relaxed">
                            Requires Node 18+. The daemon installs as a launchd / systemd user
                            service (auto-starts on boot). Remove anytime with{' '}
                            <code className="font-mono text-[11px] bg-warm-muted px-1.5 py-0.5 rounded">
                                npx @clash-space/bridge@beta uninstall
                            </code>
                            .
                        </p>
                        <div className="mt-5 text-right">
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-sm text-stone-500 hover:text-stone-700"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/**
 * One row in the "Run on" dropdown. Active row gets a checkmark + bg.
 * Disabled rows (offline runtime, no agents detected) are unclickable
 * but still visible so the user knows the runtime exists.
 */
function RuntimeMenuRow({
    label,
    sub,
    active,
    disabled,
    onClick,
}: {
    label: string;
    sub?: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-warm-muted cursor-pointer'
            } ${active ? 'bg-emerald-50/50' : ''}`}
        >
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                active ? 'bg-emerald-500' : 'bg-stone-300'
            }`} />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-700 truncate">{label}</div>
                {sub && <div className="text-[11px] text-stone-400 truncate">{sub}</div>}
            </div>
        </button>
    );
}

/**
 * Stripped-down message list for BYO mode. The cloud render path is heavy
 * (tool cards, agent personas, thinking process, mentions, …) and assumes
 * UIMessage shape from useAgentChat. BYO messages from useAgentByoBridge
 * have a much simpler shape and don't have analogues for most of that
 * UI — render them simply and add structure later as needed.
 */
function ByoMessageList({
    messages,
}: {
    messages: import('@clash/web-ui/hooks/useAgentByoBridge').ByoMessage[];
}) {
    if (messages.length === 0) {
        return (
            <div className="text-center text-sm text-stone-400 py-12">
                Local agent connected. Send a message to start.
            </div>
        );
    }
    return (
        <>
            {messages.map((m) => (
                <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className={m.role === 'user' ? 'flex justify-end' : ''}
                >
                    {m.role === 'user' ? (
                        <div className="max-w-[82%] px-4 py-3 rounded-matrix shadow-sm border bg-gradient-to-br from-red-50/90 to-pink-50/90 border-red-100/50 text-gray-900">
                            {m.parts.map((p, i) => (p.type === 'text' ? <p key={i} className="text-sm leading-relaxed mb-1 last:mb-0">{p.text}</p> : null))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {m.parts.map((p, i) => {
                                if (p.type === 'text') {
                                    return <div key={i} className="text-base text-slate-800 leading-relaxed px-1 whitespace-pre-wrap">{p.text}</div>;
                                }
                                if (p.type === 'tool_call') {
                                    return (
                                        <div key={i} className="text-xs font-mono bg-warm-muted border border-warm-border rounded px-2.5 py-1.5 text-slate-600">
                                            <span className="font-semibold">{p.name}</span>
                                            {p.input !== undefined ? <span className="opacity-70"> {JSON.stringify(p.input)}</span> : null}
                                        </div>
                                    );
                                }
                                // raw_event fallback — show JSON in collapsed form so we can debug
                                // unrecognized ACP events without losing them.
                                return (
                                    <details key={i} className="text-[11px] font-mono text-stone-400">
                                        <summary className="cursor-pointer">event</summary>
                                        <pre className="mt-1 bg-warm-muted/60 p-2 rounded overflow-x-auto">{JSON.stringify(p.event, null, 2)}</pre>
                                    </details>
                                );
                            })}
                        </div>
                    )}
                </motion.div>
            ))}
        </>
    );
}
