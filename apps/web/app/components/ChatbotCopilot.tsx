'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretLeft, CaretRight, Plus, ClockCounterClockwise, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { Command } from '../actions';
import { UserMessage } from './copilot/UserMessage';
import { AgentCard, type AgentLog } from './copilot/AgentCard';
import { ToolCall } from './copilot/ToolCall';
import { ApprovalCard } from './copilot/ApprovalCard';
import { ThinkingProcess } from './copilot/ThinkingProcess';
import { ChatInput } from './copilot/ChatInput';
import { TodoList, TodoItem } from './copilot/TodoList';
import { ThinkingIndicator } from './copilot/ThinkingIndicator';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import { SignedImg } from './SignedMedia';
import { useSignedUrl } from '@/lib/hooks/useSignedUrl';
import { thumbnailCache } from '@/lib/utils/thumbnailCache';
import { useAgentCopilot, type CustomEvent } from '../hooks/useAgentCopilot';


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
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono text-pink-500 border border-slate-200" {...props}>
                {children}
            </code>
        ) : (
            <code className="block bg-slate-900 text-slate-50 p-4 rounded-lg mb-4 overflow-x-auto text-sm font-mono" {...props}>
                {children}
            </code>
        );
    },
    pre: ({ children }: any) => <pre className="not-prose mb-4">{children}</pre>,
    blockquote: ({ children }: any) => <blockquote className="border-l-4 border-slate-200 pl-4 italic text-slate-500 mb-4">{children}</blockquote>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>,
};

/** Small component so we can call useSignedUrl per-node */
function SelectedNodeThumbnail({ node }: { node: RFNode }) {
    const signedSrc = useSignedUrl(node.data.src);
    const rawThumbnail = (node.data.referenceImageUrls && node.data.referenceImageUrls[0]) ||
                         node.data.thumbnail ||
                         thumbnailCache.get(node.data.src);
    const signedThumbnail = useSignedUrl(rawThumbnail);
    const isVideo = node.type === 'video' ||
                    node.data?.actionType === 'video-gen' ||
                    /\.(mp4|mov|webm)$/i.test(node.data?.src || '');
    return (
        <div className="w-6 h-6 rounded-md ring-2 ring-white overflow-hidden bg-slate-100 flex items-center justify-center">
            {rawThumbnail ? (
                signedThumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={signedThumbnail} alt="" className="w-full h-full object-cover" />
                ) : null
            ) : isVideo ? (
                signedSrc ? (
                    <video
                        src={`${signedSrc}#t=0.1`}
                        className="w-full h-full object-cover"
                        preload="metadata"
                        muted
                        playsInline
                    />
                ) : null
            ) : (
                signedSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={signedSrc} alt="" className="w-full h-full object-cover" />
                ) : null
            )}
        </div>
    );
}

// Module-level pending prompt — survives React Strict Mode double-mount
// and component remounts. Set by onCreateSession, consumed by auto-send.
let __pendingPrompt: { threadId: string; text: string } | null = null;

export function setPendingPrompt(threadId: string, text: string) {
    __pendingPrompt = { threadId, text };
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
    const hasPendingPrompt = !!__pendingPrompt && __pendingPrompt.threadId === threadId;

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
    const mentionableNodes = useMemo(() => {
        if (!nodes) return [];
        return nodes
            .filter((n) => ['image', 'video', 'text'].includes(n.type as string))
            .map((n) => ({
                id: n.id,
                type: n.type as string,
                label: (n.data.label as string) || n.id,
                src: n.data.src as string | undefined,
            }));
    }, [nodes]);

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

    // Auto-send pending prompt when connected and ready.
    // setTimeout ensures useAgentChat's internal WS handlers are fully set up
    // after onOpen fires. cleanup cancels on Strict Mode's first unmount.
    useEffect(() => {
        if (!__pendingPrompt || __pendingPrompt.threadId !== threadId || !connected) return;
        if (status === 'submitted' || status === 'streaming') return;
        const timer = setTimeout(() => {
            if (!__pendingPrompt || __pendingPrompt.threadId !== threadId) return;
            const text = __pendingPrompt.text;
            __pendingPrompt = null;
            sendMessage({ text });
            if (window.location.search.includes('prompt=')) {
                window.history.replaceState({}, '', window.location.pathname);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [threadId, status, connected, sendMessage]);

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
                        className="absolute right-4 top-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200/60 bg-white/80 shadow-sm backdrop-blur-xl transition-all hover:shadow-md hover:bg-white/90"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <CaretLeft className="w-5 h-5 text-slate-600" weight="bold" />
                    </motion.button>
                )}
            </AnimatePresence>

            <motion.div
                className={`h-full bg-white/80 backdrop-blur-xl flex flex-col relative ${isCollapsed ? '' : 'border-l border-slate-200 shadow-xl'}`}
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
                            className="absolute left-2 top-4 z-20 p-2 flex items-center justify-center hover:bg-gray-100/50 rounded-full transition-all"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <CaretRight className="w-5 h-5 text-gray-600" weight="bold" />
                        </motion.button>

                        {/* Session Controls */}
                        <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
                            <motion.button
                                onClick={handleNewSession}
                                className="p-2 rounded-full hover:bg-gray-100/50 text-slate-600 transition-colors"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                title="New Session"
                            >
                                <Plus className="w-5 h-5" weight="bold" />
                            </motion.button>
                            <motion.button
                                onClick={handleHistoryClick}
                                ref={historyButtonRef}
                                className="p-2 rounded-full hover:bg-gray-100/50 text-slate-600 transition-colors relative"
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
                                    className="absolute top-14 right-4 z-30 w-64 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
                                >
                                    <div className="p-3 border-b border-slate-100 bg-slate-50">
                                        <h3 className="font-display text-xs font-semibold text-slate-500 uppercase tracking-wider">Session History</h3>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {sessionHistory.length === 0 ? (
                                            <div className="p-4 text-center text-sm text-slate-400">No history yet</div>
                                        ) : (
                                            sessionHistory.map((item, index) => (
                                                <div
                                                    key={item.threadId}
                                                    className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center justify-between group"
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
                                                <UserMessage content={
                                                    msg.parts
                                                        ?.filter((p: any) => p.type === 'text')
                                                        .map((p: any) => p.text)
                                                        .join('') || ''
                                                } />
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
                                                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
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
                                        <div className="bg-white/90 backdrop-blur-md text-slate-600 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 shadow-sm flex items-center gap-2">
                                            <div className="flex -space-x-2">
                                                {selectedNodes.filter(n => n.data?.src).slice(0, 3).map((node) => (
                                                    <SelectedNodeThumbnail key={node.id} node={node} />
                                                ))}
                                            </div>
                                            <span>{selectedNodes.length} Selected</span>
                                            {selectedNodes.length === 1 && (
                                                <span className="text-slate-400 border-l border-slate-200 pl-2 max-w-[100px] truncate">
                                                    {selectedNodes[0].data?.label || selectedNodes[0].type}
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

                            <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-gray-50 via-gray-50/80 to-transparent pointer-events-none" />

                            <div className="absolute bottom-0 left-0 right-0">
                                <ChatInput
                                    input={input}
                                    onInputChange={setInput}
                                    onSubmit={handleSubmit}
                                    onStop={handleStop}
                                    isProcessing={isProcessing}
                                    isCreatingSession={isCreatingSession || hasPendingPrompt}
                                    connected={connected}
                                    error={sessionError || connectionError}
                                    onDismissError={() => { setSessionError(null); clearConnectionError(); }}
                                    placeholder={selectedNodes.length > 0 ? 'Ask anything about selected files...' : 'Ask anything...'}
                                    mentionableNodes={mentionableNodes}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </>
    );
}
