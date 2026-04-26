
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretLeft, CaretRight, Plus, ClockCounterClockwise, Trash } from '@phosphor-icons/react';
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

    const isProcessing = status === 'submitted' || status === 'streaming';

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
            if (!cancelled) setAssetThumbsByNodeId(next);
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
                                    {/* Render messages from useAgentChat */}
                                    {messages.map((msg: any) => (
                                        <motion.div
                                            key={msg.id}
                                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        >
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
                                        </motion.div>
                                    ))}

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
        </>
    );
}
