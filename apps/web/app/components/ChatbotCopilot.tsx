'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PaperPlaneRight, CaretLeft, CaretRight, Plus, ClockCounterClockwise, StopCircle, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { Command } from '../actions';
import { UserMessage } from './copilot/UserMessage';
import { AgentCard, type AgentLog } from './copilot/AgentCard';
import { ToolCall } from './copilot/ToolCall';
import { ApprovalCard } from './copilot/ApprovalCard';
import { ThinkingProcess } from './copilot/ThinkingProcess';
import { TodoList, TodoItem } from './copilot/TodoList';
import { ThinkingIndicator } from './copilot/ThinkingIndicator';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import { resolveAssetUrl } from '@/lib/utils/assets';
import { thumbnailCache } from '@/lib/utils/thumbnailCache';
import { useAgentCopilot, type CustomEvent } from '../hooks/useAgentCopilot';

const generateId = () => {
    return Date.now().toString() + Math.random().toString(36).substring(2, 9);
};

interface Message {
    id: string;
    content: string;
    role: string;
    projectId: string;
    createdAt: Date;
}

interface ChatbotCopilotProps {
    projectId: string;
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

export default function ChatbotCopilot({
    projectId,
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
    initialPrompt
}: ChatbotCopilotProps) {
    // ─── Session Management ──────────────────────────────────
    const [threadId, setThreadId] = useState<string>('');
    const [input, setInput] = useState('');
    const [isResizing, setIsResizing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [todoItems, setTodoItems] = useState<TodoItem[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
    const historyDropdownRef = useRef<HTMLDivElement | null>(null);
    const historyButtonRef = useRef<HTMLButtonElement | null>(null);

    interface SessionInfo {
        threadId: string;
        title?: string;
        updatedAt?: string;
    }
    const [sessionHistory, setSessionHistory] = useState<SessionInfo[]>([]);

    // Initialize threadId from localStorage
    useEffect(() => {
        if (typeof window === 'undefined' || threadId) return;
        const saved = localStorage.getItem(`clash_thread_id_${projectId}`);
        setThreadId(saved || generateId());
    }, [projectId, threadId]);

    // Persist threadId
    useEffect(() => {
        if (typeof window !== 'undefined' && threadId) {
            localStorage.setItem(`clash_thread_id_${projectId}`, threadId);
        }
    }, [threadId, projectId]);

    // Load session history from localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const saved = localStorage.getItem(`clash_session_history_${projectId}`);
        if (!saved) { setSessionHistory([]); return; }
        try {
            const parsed = JSON.parse(saved);
            const normalized = parsed.map((item: any) =>
                typeof item === 'string' ? { threadId: item } : item
            );
            setSessionHistory(normalized);
        } catch {
            setSessionHistory([]);
        }
    }, [projectId]);

    // Persist session history
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`clash_session_history_${projectId}`, JSON.stringify(sessionHistory));
        }
    }, [sessionHistory, projectId]);

    // ─── Agent Chat Hook ─────────────────────────────────────
    const {
        messages,
        sendMessage,
        stop,
        status,
        clearHistory,
        connected,
        customEvents,
        clearCustomEvents,
    } = useAgentCopilot({
        projectId,
        threadId,
    });

    const isProcessing = status === 'submitted' || status === 'streaming';

    // Add current threadId to session history when messages appear
    useEffect(() => {
        if (messages.length > 0 && threadId) {
            setSessionHistory(prev => {
                const exists = prev.some(s => s.threadId === threadId);
                if (exists) return prev;
                return [{ threadId, title: `Session ${threadId.slice(-6)}` }, ...prev];
            });
        }
    }, [messages.length, threadId]);

    // ─── Session Actions ─────────────────────────────────────
    const handleNewSession = useCallback(() => {
        const newThreadId = generateId();
        setThreadId(newThreadId);
        setTodoItems([]);
        clearCustomEvents();
    }, [clearCustomEvents]);

    const deleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this session?')) return;
        setSessionHistory(prev => prev.filter(s => s.threadId !== id));
        if (id === threadId) handleNewSession();
    }, [threadId, handleNewSession]);

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

    // ─── Submit ──────────────────────────────────────────────
    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isProcessing) return;
        const value = input;
        setInput('');
        setShouldStickToBottom(true);
        await sendMessage({ text: value });
    };

    // Auto-send initial prompt
    const hasAutoStartedRef = useRef(false);
    const router = useRouter();

    useEffect(() => {
        if (initialPrompt && !hasAutoStartedRef.current && connected) {
            hasAutoStartedRef.current = true;
            router.replace(`/projects/${projectId}`, { scroll: false });
            setTimeout(() => {
                sendMessage({ text: initialPrompt });
            }, 500);
        }
    }, [initialPrompt, projectId, router, sendMessage, connected]);

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
                                                        setThreadId(item.threadId);
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
                                                                const agentLogs: AgentLog[] = [];
                                                                if (progress.toolCalls?.length) {
                                                                    progress.toolCalls.forEach((tc: string, idx: number) => {
                                                                        agentLogs.push({ id: `tc-${idx}`, type: 'text', content: `→ ${tc}` });
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
                                                                        key={part.toolCallId || i}
                                                                        agentName={progress.agent || 'Agent'}
                                                                        status={progress.status === 'completed' ? 'done' : progress.status === 'failed' ? 'failed' : 'working'}
                                                                        logs={agentLogs}
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
                                                {selectedNodes.filter(n => n.data?.src).slice(0, 3).map((node) => {
                                                    const src = resolveAssetUrl(node.data.src);
                                                    const thumbnail = (node.data.referenceImageUrls && node.data.referenceImageUrls[0]) ||
                                                                    node.data.thumbnail ||
                                                                    thumbnailCache.get(node.data.src);
                                                    const isVideo = node.type === 'video' ||
                                                                   node.data?.actionType === 'video-gen' ||
                                                                   /\.(mp4|mov|webm)$/i.test(node.data?.src || '');
                                                    return (
                                                        <div key={node.id} className="w-6 h-6 rounded-md ring-2 ring-white overflow-hidden bg-slate-100 flex items-center justify-center">
                                                            {thumbnail ? (
                                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                                <img src={resolveAssetUrl(thumbnail)} alt="" className="w-full h-full object-cover" />
                                                            ) : isVideo ? (
                                                                <video
                                                                    src={`${src}#t=0.1`}
                                                                    className="w-full h-full object-cover"
                                                                    preload="metadata"
                                                                    muted
                                                                    playsInline
                                                                />
                                                            ) : (
                                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                                <img src={src} alt="" className="w-full h-full object-cover" />
                                                            )}
                                                        </div>
                                                    );
                                                })}
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

                            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-gray-50 via-gray-50/60 to-transparent pointer-events-none" />

                            <div className="absolute bottom-0 left-0 right-0 px-4 py-4">
                                <form onSubmit={handleSubmit} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        placeholder={isProcessing ? "Agent is thinking..." : (selectedNodes.length > 0 ? "Ask anything about selected files..." : "Type your message...")}
                                        className={`flex-1 px-6 py-4 bg-white backdrop-blur-xl rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white text-sm text-gray-900 placeholder:text-gray-500 border border-slate-200 transition-all shadow-sm hover:shadow-md ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        disabled={isProcessing}
                                    />
                                    {isProcessing ? (
                                        <motion.button
                                            type="button"
                                            onClick={handleStop}
                                            className="px-6 py-4 rounded-full transition-all flex items-center justify-center gap-2 bg-red-500/90 text-white shadow-lg hover:bg-red-600"
                                            whileHover={{ scale: 1.05, y: -2 }}
                                            whileTap={{ scale: 0.95 }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <StopCircle className="w-5 h-5" weight="fill" />
                                            <span className="text-sm font-medium">Stop</span>
                                        </motion.button>
                                    ) : (
                                        <motion.button
                                            type="submit"
                                            disabled={!input.trim() || isProcessing}
                                            className={`h-[54px] w-[54px] rounded-full transition-all flex items-center justify-center ${input.trim() && !isProcessing
                                                ? 'bg-gray-900/90 text-white shadow-lg'
                                                : 'bg-gray-300/60 text-gray-400 cursor-not-allowed'
                                                }`}
                                            whileHover={input.trim() ? { scale: 1.05, y: -2 } : {}}
                                            whileTap={input.trim() ? { scale: 0.95 } : {}}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <PaperPlaneRight className="w-5 h-5" weight="fill" />
                                        </motion.button>
                                    )}
                                </form>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </>
    );
}
