'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PaperPlaneRight, CaretLeft, CaretRight, Plus, ClockCounterClockwise, StopCircle, Trash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { Command } from '../actions';
import { UserMessage } from './copilot/UserMessage';
import { AgentCard, AgentLog } from './copilot/AgentCard';
import { ToolCall } from './copilot/ToolCall';
import { ApprovalCard } from './copilot/ApprovalCard';
import { NodeProposalCard } from './copilot/NodeProposalCard';
import { ThinkingProcess } from './copilot/ThinkingProcess';
import { TodoList, TodoItem } from './copilot/TodoList';
import { ThinkingIndicator } from './copilot/ThinkingIndicator';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import { resolveAssetUrl } from '@/lib/utils/assets';
import { thumbnailCache } from '@/lib/utils/thumbnailCache';

const resolveApiBaseUrl = () => {
    if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
    if (typeof window === 'undefined') return 'http://localhost:8789';
    const { hostname, origin } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? 'http://localhost:8789' : origin;
};

const API_BASE_URL = resolveApiBaseUrl();

/** Resolve WebSocket base URL from HTTP base URL. */
const resolveWsBaseUrl = () => {
    return API_BASE_URL.replace(/^http/, 'ws');
};

const WS_BASE_URL = resolveWsBaseUrl();

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
    // ─── WebSocket to SupervisorAgent ──
    // Each session (threadId) maps to its own SupervisorAgent DO instance.
    // Room name = "projectId:threadId"
    const wsRef = useRef<WebSocket | null>(null);
    const wsReadyRef = useRef(false);
    /** Accumulated chat messages (synced from AIChatAgent). */
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    /** Buffer for data stream text parsing. */
    const lineBufferRef = useRef('');
    /** Current request ID for matching responses. */
    const currentRequestIdRef = useRef<string | null>(null);

    const [displayItems, setDisplayItems] = useState<any[]>([]);
    const [isAutoPilot, _setIsAutoPilot] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState('Thinking');
    const isAutoPilotRef = useRef(isAutoPilot);

    useEffect(() => {
        isAutoPilotRef.current = isAutoPilot;
    }, [isAutoPilot]);

    // generateId moved outside component

    const [threadId, setThreadId] = useState<string>('');

    useEffect(() => {
        if (typeof window === 'undefined' || threadId) {
            return;
        }
        const saved = localStorage.getItem(`clash_thread_id_${projectId}`);
        setThreadId(saved || generateId());
    }, [projectId, threadId]);

    useEffect(() => {
        if (typeof window !== 'undefined' && threadId) {
            localStorage.setItem(`clash_thread_id_${projectId}`, threadId);
        }
    }, [threadId, projectId]);

    interface SessionInfo {
        threadId: string;
        title?: string;
        updatedAt?: string;
    }

    const [sessionHistory, setSessionHistory] = useState<SessionInfo[]>([]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const saved = localStorage.getItem(`clash_session_history_${projectId}`);
        if (!saved) {
            setSessionHistory([]);
            return;
        }
        try {
            const parsed = JSON.parse(saved);
            // Handle migration from string[] to SessionInfo[]
            const normalized = parsed.map((item: any) =>
                typeof item === 'string' ? { threadId: item } : item
            );
            setSessionHistory(normalized);
        } catch (e) {
            console.error('Failed to parse session history', e);
            setSessionHistory([]);
        }
    }, [projectId]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`clash_session_history_${projectId}`, JSON.stringify(sessionHistory));
        }
    }, [sessionHistory, projectId]);

    // Automatically add current threadId to session history if it has content
    useEffect(() => {
        if (displayItems.length > 0 && threadId) {
           setSessionHistory(prev => {
               const exists = prev.some(s => s.threadId === threadId);
               if (exists) return prev;
               return [{ threadId, title: `Session ${threadId.slice(-6)}` }, ...prev];
           });
        }
    }, [displayItems.length, threadId]);

    const [showHistory, setShowHistory] = useState(false);
    const historyDropdownRef = useRef<HTMLDivElement | null>(null);
    const historyButtonRef = useRef<HTMLButtonElement | null>(null);
    const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
    
    // Session management state
    const [sessionStatus, setSessionStatus] = useState<'idle' | 'running' | 'completing' | 'interrupted' | 'completed'>('idle');

    // Typewriter effect state
    const [_isTyping, setIsTyping] = useState(false);
    const textQueueRef = useRef<string>('');
    const typewriterIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const handleNewSession = useCallback(() => {
        console.log('[ChatbotCopilot] Starting new session reset');

        // 1. Close active WebSocket (will reconnect with new threadId)
        if (wsRef.current) {
            console.log('[ChatbotCopilot] Closing WebSocket for new session');
            wsRef.current.close();
            wsRef.current = null;
            wsReadyRef.current = false;
        }

        // 2. Clear typewriter and queue
        if (typewriterIntervalRef.current) {
            clearInterval(typewriterIntervalRef.current);
            typewriterIntervalRef.current = null;
        }
        textQueueRef.current = '';
        setIsTyping(false);

        // 3. Reset all workflow states
        const newThreadId = generateId();
        setThreadId(newThreadId);
        setChatMessages([]);
        setDisplayItems([]);
        setSessionStatus('idle');
        setIsProcessing(false);
        setProcessingStatus('');

        // 4. Reset sub-agent states and todos
        setTodoItems([]);

        console.log('[ChatbotCopilot] New session initiated:', newThreadId);
    }, []);

    // Deletes a session from local history
    const deleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        if (!window.confirm('Are you sure you want to delete this session?')) {
            return;
        }

        // Remove from local history
        setSessionHistory(prev => prev.filter(s => s.threadId !== id));

        // If we deleted the current session, start a new one
        if (id === threadId) {
            handleNewSession();
        }
    }, [threadId, handleNewSession]);

    // Stop/interrupt the current session
    const handleStop = async () => {
        console.log('[ChatbotCopilot] Stop requested');
        setSessionStatus('completing');

        // Send cancel via WebSocket
        if (wsRef.current?.readyState === WebSocket.OPEN && currentRequestIdRef.current) {
            wsRef.current.send(JSON.stringify({
                type: 'cf_agent_chat_request_cancel',
                id: currentRequestIdRef.current,
            }));
        }

        setIsProcessing(false);
        setSessionStatus('interrupted');
        currentRequestIdRef.current = null;
    };

    const loadSessionHistory = useCallback(async (id: string) => {
        console.log('[ChatbotCopilot] Loading session history:', id);
        // Session history is now managed by AIChatAgent via WebSocket.
        // Messages are persisted in the SupervisorAgent DO's SQLite.
        // On reconnect, the AIChatAgent sends cf_agent_chat_messages with the full history.
        // We load it by connecting to the agent (which happens in ensureWsConnection).
        setDisplayItems([]);
        setChatMessages([]);
        setSessionStatus('idle');
    }, []);

    // Load initial history
    useEffect(() => {
        if (threadId) {
            loadSessionHistory(threadId);
        }
    }, [threadId, loadSessionHistory]);

    const fetchProjectSessions = useCallback(async () => {
        // Session list is now managed locally (stored in localStorage).
        // Each SupervisorAgent DO persists its own chat history.
        // Future: could query DO for session list.
    }, [projectId]);

    // Initial sync of session list
    useEffect(() => {
        fetchProjectSessions();
    }, [fetchProjectSessions]);

    const handleHistoryClick = () => {
        setShowHistory((prev) => {
            const next = !prev;
            if (next) fetchProjectSessions();
            return next;
        });
    };

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
            if (event.key === "Escape") setShowHistory(false);
        };

        // Use capture so this still works even if other handlers call stopPropagation().
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [showHistory]);

    // Sync initial messages to display items
    useEffect(() => {
        if (initialMessages.length > 0 && displayItems.length === 0) {
            setDisplayItems(initialMessages.map(m => ({
                type: 'message',
                role: m.role,
                content: m.content,
                id: m.id
            })));
        }
    }, [initialMessages, displayItems.length]);

    // Flush remaining text immediately
    const flushTypewriter = useCallback(() => {
        if (textQueueRef.current.length > 0) {
            const remainingText = textQueueRef.current;
            textQueueRef.current = '';

            setDisplayItems(items => {
                const lastItem = items[items.length - 1];
                if (lastItem && lastItem.type === 'message' && lastItem.role === 'assistant') {
                    return items.map((item, index) =>
                        index === items.length - 1
                            ? { ...item, content: item.content + remainingText }
                            : item
                    );
                }
                return items;
            });
            setIsTyping(false);
        }
    }, []);

    const processTypewriterQueue = useCallback(() => {
        if (typewriterIntervalRef.current) return; // Already running

        setIsTyping(true);
        // Faster tick for smoother updates
        const TICK_DELAY = 10;

        typewriterIntervalRef.current = setInterval(() => {
            if (textQueueRef.current.length === 0) {
                if (typewriterIntervalRef.current) {
                    clearInterval(typewriterIntervalRef.current);
                    typewriterIntervalRef.current = null;
                }
                setIsTyping(false);
                return;
            }

            // Adaptive speed: if queue is long, render more chars per tick to catch up
            // Base speed: 1 char per 10ms (100 chars/sec)
            // If queue > 50 chars, speed up significantly
            const queueLength = textQueueRef.current.length;
            let charsToRender = 1;

            if (queueLength > 100) {
                charsToRender = 5; // Very fast catchup
            } else if (queueLength > 50) {
                charsToRender = 3; // Fast catchup
            } else if (queueLength > 20) {
                charsToRender = 2; // Moderate catchup
            }

            const chunk = textQueueRef.current.slice(0, charsToRender);
            textQueueRef.current = textQueueRef.current.slice(charsToRender);

            setDisplayItems(items => {
                const lastItem = items[items.length - 1];
                if (lastItem && lastItem.type === 'message' && lastItem.role === 'assistant') {
                    return items.map((item, index) =>
                        index === items.length - 1
                            ? { ...item, content: item.content + chunk }
                            : item
                    );
                }
                return items;
            });
        }, TICK_DELAY);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (typewriterIntervalRef.current) {
                clearInterval(typewriterIntervalRef.current);
            }
        };
    }, []);

    // Sync AIChatAgent messages to display items when message sync arrives
    useEffect(() => {
        if (chatMessages.length > 0) {
            // The chatMessages from AIChatAgent contain the full conversation history.
            // We don't overwrite displayItems since we have richer UI items.
            // This is mainly for tracking the conversation state.
        }
    }, [chatMessages]);

    const [input, setInput] = useState('');
    const [isResizing, setIsResizing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isLoading = isProcessing;

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
    // Map agent name -> agent_id (delegation tool_call_id) so late events without agent_id can still attach
    const agentNameToIdRef = useRef<Record<string, string>>({});

    const scrollToBottom = useCallback(() => {
        if (!shouldStickToBottom) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [shouldStickToBottom]);

    const handleScroll = () => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        const nearBottom = distanceToBottom < 120; // small buffer so user control wins once they scroll up
        setShouldStickToBottom(nearBottom);
    };

    // Use ref to access current nodes inside stale closures (EventSource listeners)
    const nodesRef = useRef(nodes);
    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    const [pendingResume, setPendingResume] = useState<{
        userInput: string;
        resume: boolean;
        inputData: any;
        expectedNodeId?: string; // Wait for this node to exist
    } | null>(null);


    // Helper to resolve name to ID using current nodes (via ref)
    // const resolveName = (name: string) => {
    //     console.log(`[ChatbotCopilot] resolveName called for: "${name}"`);
    //     const currentNodes = nodesRef.current;
    //     console.log(`[ChatbotCopilot] Current nodes available (ref):`, currentNodes.map(n => ({ id: n.id, label: n.data?.label })));
    //     const node = currentNodes.find(n => n.data?.label === name);
    //     if (node) {
    //         console.log(`[ChatbotCopilot] Found match! ID: ${node.id}`);
    //     } else {
    //         console.warn(`[ChatbotCopilot] No match found for "${name}"`);
    //     }
    //     return node?.id;
    // };

    // ─── WebSocket Connection to SupervisorAgent ──────────────
    const ensureWsConnection = useCallback((): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                resolve(wsRef.current);
                return;
            }

            // Close stale connection
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            const room = `${projectId}:${threadId}`;
            const wsUrl = `${WS_BASE_URL}/agents/supervisor/${room}`;
            console.log('[ChatbotCopilot] Opening WebSocket to SupervisorAgent:', wsUrl);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('[ChatbotCopilot] WebSocket connected');
                wsReadyRef.current = true;
                resolve(ws);
            };

            ws.onclose = () => {
                console.log('[ChatbotCopilot] WebSocket closed');
                wsReadyRef.current = false;
                if (wsRef.current === ws) {
                    wsRef.current = null;
                }
                setIsProcessing(false);
            };

            ws.onerror = (e) => {
                console.error('[ChatbotCopilot] WebSocket error:', e);
                reject(new Error('WebSocket connection failed'));
            };

            ws.onmessage = (event) => {
                if (typeof event.data !== 'string') return;

                let data: any;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    return;
                }

                // AIChatAgent protocol: data stream response chunks
                if (data.type === 'cf_agent_use_chat_response') {
                    if (data.id !== currentRequestIdRef.current) return;
                    if (!data.done) {
                        parseDataStreamChunk(data.body);
                    } else {
                        // Stream complete
                        flushTypewriter();
                        setIsProcessing(false);
                        setSessionStatus('idle');
                        currentRequestIdRef.current = null;
                    }
                    return;
                }

                // AIChatAgent protocol: message sync
                if (data.type === 'cf_agent_chat_messages') {
                    setChatMessages(data.messages);
                    return;
                }

                // Custom events from tools (node_proposal, sub_agent_start, etc.)
                handleCustomEvent(data);
            };
        });
    }, [projectId, threadId]);

    /** Parse Vercel AI SDK data stream protocol chunks. */
    const parseDataStreamChunk = useCallback((chunk: string) => {
        lineBufferRef.current += chunk;
        const lines = lineBufferRef.current.split('\n');
        lineBufferRef.current = lines.pop() || '';

        for (const line of lines) {
            if (!line) continue;
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const typeCode = line.substring(0, colonIdx);
            const rawValue = line.substring(colonIdx + 1);

            try {
                switch (typeCode) {
                    case '0': { // text delta
                        const text = JSON.parse(rawValue) as string;
                        textQueueRef.current += text;
                        processTypewriterQueue();
                        break;
                    }
                    case '9': { // tool call start
                        const toolCall = JSON.parse(rawValue);
                        setDisplayItems(prev => [...prev, {
                            type: 'tool_call',
                            id: `tc-${toolCall.toolCallId || generateId()}`,
                            props: {
                                name: toolCall.toolName,
                                args: toolCall.args,
                                status: 'running',
                            }
                        }]);
                        break;
                    }
                    case 'a': { // tool result
                        const result = JSON.parse(rawValue);
                        setDisplayItems(prev => prev.map(item =>
                            item.type === 'tool_call' && item.props?.name && item.id?.includes(result.toolCallId)
                                ? { ...item, props: { ...item.props, status: 'complete', result: result.result } }
                                : item
                        ));
                        break;
                    }
                    case 'e': { // error
                        const error = JSON.parse(rawValue);
                        setDisplayItems(prev => [...prev, {
                            type: 'message',
                            role: 'assistant',
                            content: `Error: ${error}`,
                            id: generateId()
                        }]);
                        break;
                    }
                    case 'd': { // finish
                        // Handled by the 'done' flag in cf_agent_use_chat_response
                        break;
                    }
                }
            } catch (e) {
                // Parse error on individual line, skip
            }
        }
    }, [processTypewriterQueue]);

    /** Handle custom JSON events from SupervisorAgent tools. */
    const handleCustomEvent = useCallback((data: any) => {
        if (data.type === 'node_proposal' && data.proposal) {
            setDisplayItems(prev => [...prev, {
                type: 'node_proposal',
                id: `np-${generateId()}`,
                props: data.proposal,
            }]);
        } else if (data.type === 'sub_agent_start') {
            const agentName = data.agentName;
            setDisplayItems(prev => [...prev, {
                type: 'agent_card',
                id: `agent-${generateId()}`,
                props: {
                    agentName,
                    agentId: data.agentId || agentName,
                    status: 'working',
                    logs: [],
                }
            }]);
        } else if (data.type === 'sub_agent_end') {
            const agentName = data.agentName;
            setDisplayItems(prev => prev.map(item =>
                item.type === 'agent_card' && item.props?.agentName === agentName
                    ? { ...item, props: { ...item.props, status: 'complete', result: data.result } }
                    : item
            ));
        } else if (data.type === 'timeline_edit') {
            // Timeline edits are handled by Loro sync
        }
    }, []);

    // Close WebSocket when threadId changes (session switch) or on unmount
    useEffect(() => {
        // Close previous connection — ensureWsConnection will open a new one
        // for the new threadId when the user sends a message.
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            wsReadyRef.current = false;
        }
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [threadId]);

    const runStreamScenario = useCallback(async (userInput: string, resume: boolean = false, _inputData?: any) => {
        setIsProcessing(true);
        setProcessingStatus('Thinking');
        setSessionStatus('running');
        lineBufferRef.current = '';

        // 1. Add User Message (only if not resuming)
        if (!resume) {
            const userMsgId = generateId();
            setDisplayItems(prev => [...prev, {
                type: 'message',
                role: 'user',
                content: userInput,
                id: userMsgId
            }]);
        }

        // 2. Add empty assistant message for streaming text
        const assistantMsgId = generateId();
        setDisplayItems(prev => [...prev, {
            type: 'message',
            role: 'assistant',
            content: '',
            id: assistantMsgId
        }]);

        // 3. Connect to SupervisorAgent WebSocket and send chat message
        try {
            const ws = await ensureWsConnection();

            // Build message list for the AIChatAgent protocol
            const userMsg = { id: generateId(), role: 'user', content: userInput };
            const allMessages = [...chatMessages, userMsg];

            const requestId = generateId();
            currentRequestIdRef.current = requestId;

            // Send in AIChatAgent cf_agent_use_chat_request format
            ws.send(JSON.stringify({
                type: 'cf_agent_use_chat_request',
                id: requestId,
                init: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: allMessages }),
                }
            }));

            console.log('[ChatbotCopilot] Chat message sent via WebSocket');
        } catch (e) {
            console.error('[ChatbotCopilot] Failed to send message:', e);
            setDisplayItems(prev => [...prev, {
                type: 'message',
                role: 'assistant',
                content: 'Failed to connect to AI agent. The canvas editor still works — you can create and edit nodes manually.',
                id: generateId()
            }]);
            setIsProcessing(false);
            setSessionStatus('idle');
        }

    }, [projectId, chatMessages, ensureWsConnection, flushTypewriter, processTypewriterQueue, parseDataStreamChunk]);

    // NOTE: Old SSE event listeners removed. Custom events are now handled
    // via WebSocket in handleCustomEvent and parseDataStreamChunk above.

    // Old SSE event listeners (plan, thinking, text, tool_start, tool_end, sub_agent_start,
    // sub_agent_end, human_interrupt, retry, workflow_error, error, end, session_interrupted,
    // rerun_generation_node) were removed. Event handling is now done via WebSocket in
    // handleCustomEvent and parseDataStreamChunk above.
    void 0; // placeholder

    // Effect to handle pending resume after nodes update
    useEffect(() => {
        if (pendingResume) {
            // If we are waiting for a specific node, check if it exists
            if (pendingResume.expectedNodeId) {
                const nodeExists = nodes.some(n => n.id === pendingResume.expectedNodeId);
                if (!nodeExists) {
                    // Not ready yet, keep waiting
                    return;
                }
                console.log(`[ChatbotCopilot] Node ${pendingResume.expectedNodeId} found. Resuming stream...`);
            } else if (nodes.length === 0) {
                // If not waiting for specific node, but nodes are empty (unlikely in this flow but good safety), wait
                return;
            }

            console.log('[ChatbotCopilot] Resuming stream...', pendingResume);
            runStreamScenario(pendingResume.userInput, pendingResume.resume, pendingResume.inputData);
            setPendingResume(null);
        }
    }, [nodes, pendingResume, runStreamScenario]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim()) return;

        const value = input;
        setInput('');
        setShouldStickToBottom(true);

        // If session was interrupted, we can just continue with the same thread_id
        // The backend will use the checkpoint to maintain context
        // No explicit "resume" needed - user's new message continues the conversation
        await runStreamScenario(value);
    };

    // Handle resume choice from dialog - REMOVED: no explicit dialog needed
    // User simply continues by sending a new message

    // Process data stream for commands - temporarily disabled as data is not available in useChat return
    /*
    useEffect(() => {
        if (!data) return;
        const lastData = data[data.length - 1] as any;
        if (lastData && lastData.type === 'command' && onCommand) {
             onCommand(lastData.command);
        }
    }, [data, onCommand]);
    */

    useEffect(() => {
        scrollToBottom();
    }, [isCollapsed, displayItems, shouldStickToBottom, scrollToBottom]);

    // Auto-send initial prompt if provided (simplified approach)
    const hasAutoStartedRef = useRef(false);
    const router = useRouter();

    useEffect(() => {
        // If there's an initialPrompt and we haven't sent it yet
        if (initialPrompt && !hasAutoStartedRef.current) {
            hasAutoStartedRef.current = true;

            console.log('[ChatbotCopilot] Sending initial prompt:', initialPrompt);

            // Clear the URL parameter immediately to prevent re-sending on refresh
            router.replace(`/projects/${projectId}`, { scroll: false });

            // Delay to ensure component is fully mounted
            setTimeout(() => {
                // Send as normal message (resume=false)
                runStreamScenario(initialPrompt, false);
            }, 500);
        }
    }, [initialPrompt, projectId, router, runStreamScenario]); // Depend on necessary values

    const startResizing = () => {
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            e.preventDefault();
            const newWidth = window.innerWidth - e.clientX;
            const constrainedWidth = Math.max(300, Math.min(700, newWidth));
            onWidthChange(constrainedWidth);
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
                        className={`absolute left-0 top-0 bottom-0 w-0.5 cursor-ew-resize transition-colors z-10 ${isResizing ? 'bg-red-500' : 'hover:bg-red-500 bg-red-500/0'
                            }`}
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
                                                        // Switch to this session
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
                )
                }

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
                                    {displayItems.map((item: any) => (
                                        <motion.div
                                            key={item.id}
                                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        >
                                            {item.type === 'message' && (
                                                item.role === 'user' ? (
                                                    <UserMessage content={item.content} />
                                                ) : (
                                                    <div className="text-base text-slate-800 leading-relaxed px-1 font-medium">
                                                        <ReactMarkdown
                                                            components={{
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
                                                            }}
                                                        >
                                                            {item.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                )
                                            )}
                                            {item.type === 'agent_card' && (
                                                <AgentCard {...item.props} />
                                            )}
                                            {item.type === 'tool_call' && (
                                                <ToolCall {...item.props} />
                                            )}
                                            {item.type === 'approval_card' && (
                                                <ApprovalCard {...item.props} />
                                            )}
                                            {item.type === 'thinking' && (
                                                <ThinkingProcess content={item.content} />
                                            )}
                                            {item.type === 'node_proposal' && (
                                                <NodeProposalCard {...item.props} />
                                            )}
                                        </motion.div>
                                    ))}

                                    {isProcessing && (
                                        <ThinkingIndicator message={processingStatus} />
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
                                                    // Choice 1: Reference images (for generated videos, this is the most reliable start frame)
                                                    // Choice 2: Legacy thumbnail in node data
                                                    // Choice 3: Local storage cache (canvas capture)
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
                                        disabled={isLoading || isProcessing}
                                    />
                                    {sessionStatus === 'running' ? (
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
                                            disabled={!input.trim() || isLoading || isProcessing}
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
