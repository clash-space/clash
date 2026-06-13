
import { memo, useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { CaretRight, Plus, ClockCounterClockwise, Trash, Plug } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
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
import { RuntimePickerDialog } from './copilot/RuntimePickerDialog';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { useClashRuntime, type Runtime } from '@clash/web-ui/hooks/useClashRuntime';
import type { ByoMessage as RuntimeMessage } from '@clash/web-ui/lib/acpEvents';
import { parseAgentCanvasPatch } from '@clash/web-ui/lib/agentCanvasPatch';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { useAsset, getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { useIsBelowLg } from '@clash/web-ui/lib/hooks/useMediaQuery';
import { useFocusTrap } from '@clash/web-ui/lib/hooks/useFocusTrap';
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
    // Demote heading levels: assistant messages live deep inside the page,
    // so their `#` headings shouldn't compete with the page's real h1/h2.
    // Visual sizes preserved.
    h1: ({ children }: any) => <h2 className="font-display text-2xl font-bold mb-4 mt-6">{children}</h2>,
    h2: ({ children }: any) => <h3 className="font-display text-xl font-bold mb-3 mt-5">{children}</h3>,
    h3: ({ children }: any) => <h4 className="font-display text-lg font-bold mb-2 mt-4">{children}</h4>,
    h4: ({ children }: any) => <h5 className="font-display text-base font-bold mb-2 mt-3">{children}</h5>,
    code: ({ className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const isInline = !match && !String(children).includes('\n');
        return isInline ? (
            <code className="bg-warm-muted px-1.5 py-0.5 rounded text-sm font-mono text-brand border border-warm-border dark:text-brand-light" {...props}>
                {children}
            </code>
        ) : (
            <code className="clash-copilot-code block rounded-xl p-4 mb-4 overflow-x-auto text-sm font-mono" {...props}>
                {children}
            </code>
        );
    },
    pre: ({ children }: any) => <pre className="not-prose mb-4">{children}</pre>,
    blockquote: ({ children }: any) => <blockquote className="border-l-4 border-warm-border pl-4 italic text-stone-600 mb-4 dark:text-stone-300">{children}</blockquote>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface rounded-sm">{children}</a>,
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
    const label = typeof data.label === 'string' && data.label
        ? data.label
        : node.type ?? 'media';
    return (
        <div className="w-6 h-6 rounded-md ring-2 ring-warm-surface overflow-hidden bg-warm-muted flex items-center justify-center">
            {isVideo && asset?.srcR2Key && !asset?.coverR2Key && signedUrl ? (
                <video
                    src={`${signedUrl}#t=0.1`}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    muted
                    playsInline
                    aria-label={label}
                />
            ) : signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={signedUrl} alt={label} className="w-full h-full object-cover" />
            ) : null}
        </div>
    );
}

type MentionNodeRef = { id: string; type: string; label: string; thumbnail?: string };

const PERSONA_MAP: Record<string, string> = {
    ScriptWriter: 'scriptwriter',
    ConceptArtist: 'conceptartist',
    StoryboardDesigner: 'storyboardartist',
    Editor: 'videoproducer',
};

/**
 * Memoized single part of an assistant message (text / reasoning / tool-call
 * / step-divider). Lifted out so React.memo's shallow equality can skip
 * re-renders of unchanged parts within the currently-streaming message —
 * useAgentCopilot's streaming pattern gives a new reference only to the
 * actively-updating part, so every other part in the same message skips
 * ReactMarkdown parse and AgentCard logs rebuild on every token tick.
 */
const MessagePart = memo(function MessagePart({ part }: { part: any }) {
    if (part.type === 'text' && part.text) {
        return (
            <div className="text-base text-slate-800 leading-relaxed px-1 font-medium dark:text-slate-100">
                <ReactMarkdown components={markdownComponents}>{part.text}</ReactMarkdown>
            </div>
        );
    }
    if (part.type === 'reasoning') {
        return <ThinkingProcess content={part.text} />;
    }
    if (part.type === 'step-start') {
        return <div className="border-t border-warm-border my-2" />;
    }
    if (part.type?.startsWith('tool-') || part.type === 'dynamic-tool') {
        const toolName = part.type === 'dynamic-tool'
            ? part.toolName
            : part.type.replace('tool-', '');

        if (toolName === 'task_delegation' && part.preliminary && part.output) {
            const progress = part.output as any;
            const agentName = progress.agent || 'Agent';
            const agentLogs: AgentLog[] = [];

            if (progress.toolCalls?.length) {
                progress.toolCalls.forEach((tc: any) => {
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

            return (
                <AgentCard
                    agentName={agentName}
                    status={progress.status === 'completed' ? 'done' : progress.status === 'failed' ? 'failed' : 'working'}
                    logs={agentLogs}
                    persona={(PERSONA_MAP[agentName] || 'default') as any}
                />
            );
        }

        const toolStatus = part.state === 'output-available' ? 'success'
            : part.state === 'output-error' ? 'error'
            : part.state === 'approval-requested' ? 'pending'
            : 'pending' as const;
        return (
            <ToolCall
                toolName={toolName}
                args={part.input}
                result={part.output}
                status={toolStatus}
            />
        );
    }
    return null;
});

/**
 * Memoized message row. Lifted out of the main component so React.memo can
 * skip re-renders of unchanged messages during streaming — without this,
 * every token tick re-runs ReactMarkdown for every prior message in the
 * thread (O(n) work per chunk).
 *
 * Only re-renders when its `msg` reference or `mentionableNodes` ref changes.
 * useAgentCopilot mutates only the streaming message, so completed messages
 * stay referentially stable and are skipped entirely.
 */
const MessageRow = memo(function MessageRow({
    msg,
    mentionableNodes,
}: {
    msg: any;
    mentionableNodes: MentionNodeRef[];
}) {
    return (
        // content-visibility: auto lets the browser skip paint + layout for
        // off-screen rows — native render-skipping that scales to long threads
        // without virtualization's architectural cost. contain-intrinsic-size
        // gives a height hint so the scrollbar doesn't jitter as rows enter
        // the viewport and self-measure. 200px is a reasonable average for
        // mixed text + tool-call messages; under-/over-estimates self-correct
        // after first measurement.
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}
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
                        {msg.parts?.map((part: any, i: number) => (
                            <MessagePart key={part.toolCallId ?? part.id ?? i} part={part} />
                        ))}
                    </div>
                )}
            </MessageErrorBoundary>
        </motion.div>
    );
});

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
    onAddNode,
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
    const { t } = useTranslation();
    const historyMenuId = useId();
    const runtimeMenuId = useId();
    // Below Tailwind's `lg` (1024px), the panel switches to a full-screen
    // sheet over the canvas. Desktop keeps the resizable side panel.
    const isMobile = useIsBelowLg();
    // ─── UI State ──────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [isResizing, setIsResizing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
    const [suggestions, setSuggestions] = useState<Array<{ label: string; message: string }>>([]);

    // Two transports:
    //   - 'cloud'   : useAgentCopilot (hosted Clash agent)
    //   - 'runtime' : useClashRuntime (registered local daemon / clashd)
    const [chatMode, setChatMode] = useState<'cloud' | 'runtime'>('cloud');
    const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
    const [addMachineOpen, setAddMachineOpen] = useState(false);
    /** When set, the runtime picker dialog is open for this runtime. */
    const [runtimePicker, setRuntimePicker] = useState<Runtime | null>(null);
    const clashRt = useClashRuntime();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
    const historyDropdownRef = useRef<HTMLDivElement | null>(null);
    const historyButtonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLElement | null>(null);
    const appliedRuntimeCanvasNodesRef = useRef<Set<string>>(new Set());

    // Focus trap on mobile: when the sheet covers the viewport it should
    // behave like a true dialog — keep keyboard focus inside until close.
    const closeMobileSheet = useCallback(() => onCollapseChange(true), [onCollapseChange]);
    useFocusTrap(panelRef, isMobile && !isCollapsed, closeMobileSheet);

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
    // Drop back to cloud if the daemon session dies.
    useEffect(() => {
        if (chatMode === 'runtime' && (clashRt.status === 'disconnected' || clashRt.status === 'idle')) {
            // Don't reset on 'idle' if it's the *initial* idle (no select yet);
            // we only want this on transition away from a working session.
            if (clashRt.status === 'disconnected') setChatMode('cloud');
        }
    }, [clashRt.status, chatMode]);

    const runtimeIsProcessing = clashRt.status === 'connecting' || clashRt.status === 'sending' || clashRt.status === 'streaming';
    const isProcessing =
        chatMode === 'runtime' ? runtimeIsProcessing :
        cloudIsProcessing;

    useEffect(() => {
        if (chatMode !== 'runtime' || !onAddNode) return;

        for (const message of clashRt.messages) {
            for (const part of message.parts) {
                if (part.type !== 'raw_event') continue;
                const operations = parseAgentCanvasPatch(part.event);
                for (const operation of operations) {
                    if (operation.op !== 'add_node') continue;
                    const patchNode = operation.node;
                    if (appliedRuntimeCanvasNodesRef.current.has(patchNode.id)) continue;
                    appliedRuntimeCanvasNodesRef.current.add(patchNode.id);

                    onAddNode(patchNode.type, {
                        id: patchNode.id,
                        ...(patchNode.data ?? {}),
                        ...(patchNode.position ? { position: patchNode.position } : {}),
                        ...(patchNode.parentId ? { parentId: patchNode.parentId } : {}),
                        ...(patchNode.width !== undefined ? { width: patchNode.width } : {}),
                        ...(patchNode.height !== undefined ? { height: patchNode.height } : {}),
                        ...(patchNode.style ? { style: patchNode.style } : {}),
                    });
                }
            }
        }
    }, [chatMode, clashRt.messages, onAddNode]);

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
            if (event.key === 'Escape') {
                setShowHistory(false);
                // Return focus to the trigger so keyboard users keep their place.
                historyButtonRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showHistory]);

    // Close runtime menu on Escape too.
    useEffect(() => {
        if (!runtimeMenuOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setRuntimeMenuOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [runtimeMenuOpen]);

    // On mobile, the panel covers the canvas — lock body scroll while open.
    // (Escape-to-close + focus trap are handled by useFocusTrap above.)
    useEffect(() => {
        if (!isMobile || isCollapsed) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [isMobile, isCollapsed]);

    // ─── Scroll ──────────────────────────────────────────────
    const scrollToBottom = useCallback(() => {
        if (!shouldStickToBottom) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [shouldStickToBottom]);

    // Stick-to-bottom is driven by IntersectionObserver instead of an
    // onScroll handler so we don't force a layout read (scrollHeight) on
    // every wheel tick. The observer fires only when the intersection
    // state of the bottom sentinel actually changes.
    //
    // rootMargin bottom: 120px → the sentinel is treated as "visible" as
    // long as the user is within 120px of the bottom. Matches the prior
    // `distanceToBottom < 120` heuristic.
    useEffect(() => {
        const sentinel = messagesEndRef.current;
        const container = scrollContainerRef.current;
        if (!sentinel || !container) return;
        const observer = new IntersectionObserver(
            ([entry]) => setShouldStickToBottom(entry.isIntersecting),
            { root: container, rootMargin: '0px 0px 120px 0px', threshold: 0 },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [isCollapsed]);

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

        // Persistent-runtime mode: raw prompt, daemon handles the local ACP session.
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
        // rAF-coalesce: native mousemove fires far faster than 60fps; we only
        // need one width update per frame. Without this, every move triggers
        // a state update + reflow that competes with streaming-message renders.
        let rafId: number | null = null;
        let pendingX: number | null = null;
        const flush = () => {
            rafId = null;
            if (pendingX == null) return;
            const newWidth = window.innerWidth - pendingX;
            pendingX = null;
            onWidthChange(Math.max(300, Math.min(700, newWidth)));
        };
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            e.preventDefault();
            pendingX = e.clientX;
            if (rafId == null) rafId = requestAnimationFrame(flush);
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
            if (rafId != null) cancelAnimationFrame(rafId);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, onWidthChange]);

    // ─── Render ──────────────────────────────────────────────
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence>
                {isCollapsed && (
                    <motion.button
                        type="button"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => onCollapseChange(false)}
                        aria-label={t('copilot.panel.expand')}
                        aria-expanded={false}
                        aria-controls="clash-copilot-panel"
                        // Clears the iPhone home-indicator gesture zone with safe-area-inset-bottom
                        // while keeping the same bottom-right launcher position on desktop.
                        className="clash-copilot-launcher fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex h-20 w-20 items-center justify-center rounded-[26px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                        whileHover={{ scale: 1.035, y: -1 }}
                        whileTap={{ scale: 0.965 }}
                    >
                        <img
                            src="/brand/logo-mark-animated.svg"
                            alt=""
                            className="h-16 w-16 object-contain"
                            draggable={false}
                            aria-hidden="true"
                        />
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Mobile backdrop — only visible below lg when panel is open. */}
            <AnimatePresence>
                {isMobile && !isCollapsed && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm lg:hidden"
                        onClick={() => onCollapseChange(true)}
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <motion.aside
                ref={panelRef as React.RefObject<HTMLElement>}
                id="clash-copilot-panel"
                aria-label={t('copilot.panel.label')}
                aria-hidden={isCollapsed}
                aria-modal={isMobile && !isCollapsed ? 'true' : undefined}
                role={isMobile && !isCollapsed ? 'dialog' : undefined}
                tabIndex={isMobile && !isCollapsed ? -1 : undefined}
                className={
                    isMobile
                        // Mobile: bg-warm-page extends to the unsafe areas so the system bars blend with the panel; padding shrinks the positioning context so absolute children land inside the safe zone. All four insets cover portrait (notch top, home indicator bottom) and landscape (notch on left or right).
                        ? `fixed inset-0 z-50 flex flex-col bg-warm-page h-[100dvh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] ${isCollapsed ? 'pointer-events-none' : ''}`
                        : `h-full bg-warm-surface flex flex-col relative ${isCollapsed ? '' : 'border-l border-warm-border shadow-[0_18px_50px_rgba(35,31,25,0.1)]'}`
                }
                style={isMobile ? undefined : { width: isCollapsed ? 0 : `${width}px` }}
                animate={
                    isMobile
                        ? { x: isCollapsed ? '100%' : 0 }
                        : { width: isCollapsed ? 0 : width }
                }
                initial={false}
                transition={isResizing ? { duration: 0 } : { duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
            >
                {/* Screen-reader-only heading: gives heading-nav rotor users
                    a landmark to jump to. Hidden visually because the panel
                    already shows its purpose via design + the floating
                    toggle button. */}
                <h2 className="sr-only">{t('copilot.panel.label')}</h2>
                {!isCollapsed && !isMobile && (
                    <div
                        onMouseDown={startResizing}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize panel"
	                        className={`absolute left-0 top-0 bottom-0 w-0.5 cursor-ew-resize transition-colors z-10 ${isResizing ? 'bg-brand' : 'hover:bg-brand bg-brand/0'}`}
                    />
                )}

                {!isCollapsed && (
                    <>
                        <IconButton
                            onClick={() => onCollapseChange(true)}
                            label={t('copilot.panel.collapse')}
                            aria-expanded={true}
                            aria-controls="clash-copilot-panel"
                            icon={<CaretRight className="w-5 h-5" weight="bold" />}
                            className="absolute left-2 top-4 z-20 text-stone-700 dark:text-stone-300"
                        />

                        <div className="pointer-events-none absolute left-12 top-4 z-20 flex h-10 items-center gap-2">
                            <img
                                src="/brand/logo-mark-animated.svg"
                                alt=""
                                aria-hidden="true"
                                className="h-10 w-10 object-contain"
                                draggable={false}
                            />
                            <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {t('copilot.panel.label')}
                            </span>
                        </div>

                        {/* Session Controls */}
                        <div className="absolute right-4 top-4 z-20 flex items-center gap-1" role="toolbar" aria-label={t('copilot.panel.label')}>
                            <IconButton
                                onClick={handleNewSession}
                                label={t('copilot.header.newSession')}
                                icon={<Plus className="w-5 h-5" weight="bold" />}
                            />
                            <IconButton
                                ref={historyButtonRef}
                                onClick={handleHistoryClick}
                                label={t('copilot.header.history')}
                                aria-expanded={showHistory}
                                aria-controls={historyMenuId}
                                aria-haspopup="dialog"
                                className="relative"
                                icon={
                                    <>
                                        <ClockCounterClockwise className="w-5 h-5" weight="bold" />
                                        {sessionHistory.length > 0 && (
                                            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand rounded-full border border-warm-surface" />
                                        )}
                                    </>
                                }
                            />
                            {/* "Run on:" picker. Click opens menu; brand-tinted when something other than Cloud is the active runtime. */}
                            <div className="relative">
                                <IconButton
                                    onClick={() => {
                                        // Refresh the runtime list each time the menu opens so
                                        // users don't see a stale offline marker right after
                                        // starting their daemon.
                                        if (!runtimeMenuOpen) void clashRt.refresh();
                                        setRuntimeMenuOpen((v) => !v);
                                    }}
                                    label={t('copilot.header.runOn')}
                                    aria-expanded={runtimeMenuOpen}
                                    aria-controls={runtimeMenuId}
                                    aria-haspopup="menu"
                                    variant={chatMode !== 'cloud' ? 'active' : 'default'}
                                    icon={<Plug className="w-5 h-5" weight="bold" />}
                                />
                                <AnimatePresence>
                                    {runtimeMenuOpen && (
                                        <motion.div
                                            id={runtimeMenuId}
                                            role="menu"
                                            aria-label={t('copilot.runtime.menuTitle')}
                                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
	                                            className="absolute top-11 right-0 z-30 w-72 bg-warm-surface rounded-2xl shadow-[0_18px_48px_rgba(35,31,25,0.12)] border border-warm-border overflow-hidden"
                                        >
                                            <div className="px-3 py-2 border-b border-warm-border bg-warm-muted">
                                                <div className="font-display text-xs font-semibold text-stone-700 uppercase tracking-wider dark:text-stone-300">{t('copilot.runtime.menuTitle')}</div>
                                            </div>
                                            <div className="py-1">
                                                <RuntimeMenuRow
                                                    label={t('copilot.runtime.cloud.label')}
                                                    sub={t('copilot.runtime.cloud.sub')}
                                                    active={chatMode === 'cloud'}
                                                    onClick={() => {
                                                        if (chatMode === 'runtime') clashRt.shutdown();
                                                        setChatMode('cloud');
                                                        setRuntimeMenuOpen(false);
                                                    }}
                                                />
                                                {clashRt.runtimes.length > 0 && (
                                                    <div role="presentation" className="px-3 pt-1 pb-0.5 text-[11px] text-stone-600 uppercase tracking-wider dark:text-stone-400">{t('copilot.runtime.machinesHeader')}</div>
                                                )}
                                                {clashRt.runtimes.map((rt) => {
                                                    const online = rt.status === 'online';
                                                    const sub = online
                                                        ? t('copilot.runtime.machineSub_online', { count: rt.agents.length })
                                                        : t('copilot.runtime.machineSub_offline');
                                                    return (
                                                        <RuntimeMenuRow
                                                            key={rt.id}
                                                            label={rt.hostname || rt.machine_id.slice(0, 10)}
                                                            sub={sub}
                                                            active={chatMode === 'runtime' && clashRt.selectedRuntimeId === rt.id}
                                                            disabled={!online || rt.agents.length === 0}
                                                            onClick={() => {
                                                                // Open the daemon picker so runtime sessions keep
                                                                // the same agent + resume-session UX.
                                                                setRuntimeMenuOpen(false);
                                                                setRuntimePicker(rt);
                                                            }}
                                                        />
                                                    );
                                                })}
                                                <div role="separator" className="border-t border-warm-border/70 my-1" />
                                                <RuntimeMenuRow
                                                    label={t('copilot.runtime.addMachine.label')}
                                                    sub={t('copilot.runtime.addMachine.sub')}
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
                                    id={historyMenuId}
                                    role="dialog"
                                    aria-label={t('copilot.history.title')}
                                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                    ref={historyDropdownRef}
	                                    className="absolute top-14 right-4 z-30 w-64 bg-warm-surface rounded-2xl shadow-[0_18px_48px_rgba(35,31,25,0.12)] border border-warm-border overflow-hidden"
                                >
                                    <div className="p-3 border-b border-warm-border bg-warm-muted">
                                        <h3 className="font-display text-xs font-semibold text-stone-700 uppercase tracking-wider dark:text-stone-300">{t('copilot.history.title')}</h3>
                                    </div>
                                    <ul className="max-h-60 overflow-y-auto" role="list">
                                        {sessionHistory.length === 0 ? (
                                            <li className="p-4 text-center text-sm text-slate-700 dark:text-slate-300">{t('copilot.history.empty')}</li>
                                        ) : (
                                            sessionHistory.map((item, index) => (
                                                <li
                                                    key={item.threadId}
                                                    className="border-b border-warm-border/70 last:border-0 group"
                                                >
                                                    <div className="flex items-stretch">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                onSwitchSession?.(item.threadId);
                                                                setShowHistory(false);
                                                                historyButtonRef.current?.focus();
                                                            }}
                                                            className="flex-1 text-left px-4 py-3 hover:bg-warm-muted transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                                                        >
                                                            <span className="flex flex-col min-w-0">
                                                                <span className="text-sm font-medium text-slate-800 truncate max-w-[180px] dark:text-slate-100">
                                                                    {item.title || t('copilot.history.fallbackTitle', { index: index + 1 })}
                                                                </span>
                                                                <span className="text-[11px] text-slate-600 font-mono dark:text-slate-400">{item.threadId.slice(-6)}</span>
                                                            </span>
                                                            <CaretRight className="w-3 h-3 text-slate-500 dark:text-slate-400 flex-shrink-0" aria-hidden="true" />
                                                        </button>
                                                        <IconButton
                                                            onClick={(e) => deleteSession(item.threadId, e)}
                                                            label={t('copilot.history.delete')}
                                                            variant="destructive"
                                                            size="sm"
                                                            icon={<Trash className="w-3.5 h-3.5" />}
                                                            className="mr-1 my-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                        />
                                                    </div>
                                                </li>
                                            ))
                                        )}
                                    </ul>
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
                                className="absolute inset-0 top-16 overflow-y-auto px-6 pt-4 pb-32"
                            >
                                <div className="space-y-6">
                                    {/* Runtime mode produces the local ACP message shape.
                                        Cloud renders the heavier UIMessage path. */}
                                    {chatMode === 'runtime' && (
                                        <>
                                            {clashRt.status === 'connecting' && (
                                                <div role="status" aria-live="polite" className="text-xs text-stone-600 italic dark:text-stone-300">{t('copilot.status.connecting')}</div>
                                            )}
                                            {clashRt.errorMessage && (
                                                <div role="alert" className="text-sm text-red-700 dark:text-red-300">{t('copilot.errors.warningPrefix')} {clashRt.errorMessage}</div>
                                            )}
                                            <RuntimeMessageList messages={clashRt.messages} />
                                        </>
                                    )}
                                    {chatMode === 'cloud' && (
                                        <>
                                            {messages.map((msg: any) => (
                                                <MessageRow
                                                    key={msg.id}
                                                    msg={msg}
                                                    mentionableNodes={mentionableNodes}
                                                />
                                            ))}
                                        </>
                                    )}

                                    {isProcessing && (
                                        <div role="status" aria-live="polite">
                                            <ThinkingIndicator message={status === 'submitted' ? t('copilot.status.thinking') : t('copilot.status.streaming')} />
                                        </div>
                                    )}

                                    {/* Suggestion chips (e.g. "Continue" after step limit) */}
                                    {suggestions.length > 0 && !isProcessing && (
                                        <motion.div
                                            role="group"
                                            aria-label="Suggestions"
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="flex flex-wrap gap-2 px-1"
                                        >
                                            {suggestions.map((s, i) => (
                                                <motion.button
                                                    type="button"
                                                    key={i}
                                                    onClick={() => handleSubmit(s.message)}
	                                                    className="px-4 py-2 min-h-[36px] text-sm font-medium text-slate-800 bg-warm-surface border border-warm-border rounded-xl shadow-sm hover:bg-warm-muted hover:border-brand/30 transition-all dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                                                    whileHover={{ scale: 1.03 }}
                                                    whileTap={{ scale: 0.97 }}
                                                    transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
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
                                        <div
                                            role="status"
                                            aria-live="polite"
	                                            className="bg-warm-surface text-slate-800 text-xs font-medium px-3 py-1.5 rounded-xl border border-warm-border shadow-md flex items-center gap-2 dark:text-slate-100"
                                        >
                                            <div className="flex -space-x-2" aria-hidden="true">
                                                {selectedNodes.filter(n => !!n.data?.assetId).slice(0, 3).map((node) => (
                                                    <SelectedNodeThumbnail key={node.id} node={node} />
                                                ))}
                                            </div>
                                            <span>{t('copilot.selectedContext.count', { count: selectedNodes.length })}</span>
                                            {selectedNodes.length === 1 && (
                                                <span className="text-stone-600 border-l border-warm-border pl-2 max-w-[100px] truncate dark:text-stone-300">
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
                                {/* Slash commands the spawned ACP agent advertises (only present
                                    in runtime mode). Click → prepends `/<name> ` into the
                                    input so the user can finish typing args before sending. */}
                                {chatMode !== 'cloud' && (() => {
                                    const cmds = clashRt.availableCommands;
                                    if (!cmds || cmds.length === 0) return null;
                                    return (
                                        <SlashCommandBar
                                            commands={cmds}
                                            onPick={(name) => setInput((prev) => `/${name} ` + (prev?.startsWith('/') ? '' : prev))}
                                        />
                                    );
                                })()}
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
            </motion.aside>

            <AddMachineDialog open={addMachineOpen} onClose={() => setAddMachineOpen(false)} />
            <RuntimePickerDialog
                open={!!runtimePicker}
                runtime={runtimePicker}
                loadResumeOptions={clashRt.loadResumeOptions}
                onPick={async (crewId, resumeId, agentId) => {
                    const rt = runtimePicker;
                    setRuntimePicker(null);
                    if (!rt) return;
                    setChatMode('runtime');
                    await clashRt.select(rt.id, crewId ?? undefined, {
                        projectId,
                        resumeAcpSessionId: resumeId,
                        agentId,
                    });
                }}
                onClose={() => setRuntimePicker(null)}
                busy={clashRt.status === 'connecting'}
            />
        </MotionConfig>
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
    const { t } = useTranslation();
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
        <Dialog
            open={open}
            onClose={onClose}
            title={t('copilot.addMachine.title')}
            description={t('copilot.addMachine.intro')}
            size="lg"
        >
            <div className="text-xs uppercase tracking-wider text-stone-600 mb-2 dark:text-stone-400">
                {t('copilot.addMachine.runInTerminal')}
            </div>
            <div className="flex items-stretch gap-2 mb-3">
                <code className="clash-copilot-code flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-xl px-3 py-2.5 font-mono text-sm select-all">
                    {cmd}
                </code>
                <button
                    type="button"
                    onClick={onCopy}
                    aria-label={t('copilot.addMachine.copy')}
                    className="px-3 min-h-[44px] rounded-lg bg-warm-muted hover:bg-warm-hover text-slate-800 transition-colors text-sm font-medium dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                >
                    {copied ? t('copilot.addMachine.copied') : t('copilot.addMachine.copy')}
                </button>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed dark:text-stone-400">
                {t('copilot.addMachine.footnote')}{' '}
                <code className="font-mono text-[11px] bg-warm-muted px-1.5 py-0.5 rounded">
                    npx @clash-space/bridge@beta uninstall
                </code>
                .
            </p>
        </Dialog>
    );
}

/**
 * Horizontal scrollable bar of `/` commands the spawned ACP agent
 * advertised via available_commands_update. Hidden when the agent
 * hasn't reported any (or when in cloud mode). One-click prepends
 * `/<name> ` into the input so the user can add args + send.
 *
 * Capped to first ~12 commands so the bar doesn't dominate the panel
 * — claude-code-acp ships ~50 by default. Tooltip shows description.
 */
function SlashCommandBar({
    commands,
    onPick,
}: {
    commands: import('@clash/web-ui/lib/acpEvents').AvailableCommand[];
    onPick: (name: string) => void;
}) {
    const { t } = useTranslation();
    const visible = commands.slice(0, 12);
    return (
        <div role="group" aria-label="Slash commands" className="px-4 pb-1 -mb-1 overflow-x-auto whitespace-nowrap text-xs">
            {visible.map((c) => (
                <button
                    key={c.name}
                    type="button"
                    onClick={() => onPick(c.name)}
                    title={c.description ?? c.name}
                    aria-label={c.description ? `/${c.name} — ${c.description}` : `/${c.name}`}
	                    className="inline-flex items-center mr-1.5 px-2 py-1 min-h-[28px] rounded-lg bg-warm-muted text-stone-700 hover:bg-warm-hover transition-colors font-mono dark:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-warm-page"
                >
                    /{c.name}
                </button>
            ))}
            {commands.length > visible.length && (
                <span className="text-stone-600 ml-1 dark:text-stone-400">{t('copilot.status.slashCommandsMore', { count: commands.length - visible.length })}</span>
            )}
        </div>
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
            role="menuitem"
            aria-checked={active}
            disabled={disabled}
            onClick={onClick}
            className={`w-full text-left px-3 py-2 min-h-[44px] flex items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                disabled
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:bg-warm-muted cursor-pointer'
            } ${active ? 'bg-brand/10 dark:bg-brand/15' : ''}`}
        >
            <span
                aria-hidden="true"
                className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    active ? 'bg-brand' : 'bg-stone-400 dark:bg-stone-500'
                }`}
            />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate dark:text-slate-100">{label}</div>
                {sub && <div className="text-[11px] text-stone-600 truncate dark:text-stone-400">{sub}</div>}
            </div>
        </button>
    );
}

/**
 * Stripped-down message list for local runtime mode. The cloud render path is heavy
 * (tool cards, agent personas, thinking process, mentions, …) and assumes
 * UIMessage shape from useAgentChat. Runtime messages are already normalized
 * to parts.
 */
function RuntimeMessageList({
    messages,
}: {
    messages: RuntimeMessage[];
}) {
    const { t } = useTranslation();
    if (messages.length === 0) {
        return (
            <div className="text-center text-sm text-stone-600 py-12 dark:text-stone-300">
                {t('copilot.status.localAgentReady')}
            </div>
        );
    }
    return (
        <>
            {messages.map((m) => (
                <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                    className={m.role === 'user' ? 'flex justify-end' : ''}
                >
                    {m.role === 'user' ? (
                        <div className="max-w-[82%] px-4 py-3 rounded-matrix shadow-sm border bg-brand-light border-warm-border text-slate-900 dark:bg-warm-muted dark:text-slate-100 dark:border-warm-border">
                            {m.parts.map((p, i) => (p.type === 'text' ? <p key={i} className="text-sm leading-relaxed mb-1 last:mb-0">{p.text}</p> : null))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {m.parts.map((p, i) => {
                                if (p.type === 'text') {
                                    return <div key={i} className="text-base text-slate-800 leading-relaxed px-1 whitespace-pre-wrap dark:text-slate-100">{p.text}</div>;
                                }
                                if (p.type === 'thought') {
                                    return <div key={i} className="text-sm text-stone-600 leading-relaxed px-1 whitespace-pre-wrap italic dark:text-stone-300">{p.text}</div>;
                                }
                                if (p.type === 'plan') {
                                    return null;
                                }
                                if (p.type === 'tool_call') {
                                    return (
                                        <div key={i} className="text-xs font-mono bg-warm-muted border border-warm-border rounded px-2.5 py-1.5 text-slate-700 dark:text-slate-300">
                                            <span className="font-semibold">{p.toolName || p.title || 'tool'}</span>
                                            {p.rawInput !== undefined ? <span className="opacity-80"> {JSON.stringify(p.rawInput)}</span> : null}
                                        </div>
                                    );
                                }
                                if (p.type !== 'raw_event') {
                                    return null;
                                }
                                if (parseAgentCanvasPatch(p.event).length > 0) {
                                    return null;
                                }
                                // raw_event fallback — show JSON in collapsed form so we can debug
                                // unrecognized ACP events without losing them.
                                return (
                                    <details key={i} className="text-[11px] font-mono text-stone-700 dark:text-stone-300">
                                        <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm">event</summary>
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
