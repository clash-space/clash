
import { memo, useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { ArrowBendDownRight, CaretRight, DotsSixVertical, DotsThree, PencilSimple, Plus, ClockCounterClockwise, Trash, Plug, ShieldWarning } from '@phosphor-icons/react';
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
import { AcpMessageList, AcpProgressPanel, getAcpGlobalState } from './copilot/AcpMessageList';
import { AgentMotion, type AgentMotionState } from './copilot/AgentMotion';
import { AcpAgentLogo } from './copilot/AcpAgentLogo';
import { CopilotRailSlot } from './copilot/CopilotRail';
import { MessageErrorBoundary } from './copilot/MessageErrorBoundary';
import { RuntimePickerDialog } from './copilot/RuntimePickerDialog';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { SelectMenu, type SelectSection } from './ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useAppFeedback } from './AppFeedback';
import { useClashRuntime, type AcpSessionConfigOption, type AcpSessionModeState, type ClashRuntimeStatus, type Runtime, type RuntimePromptQueueMode, type RuntimeQueuedPrompt, type RuntimeSessionInfo } from '@clash/web-ui/hooks/useClashRuntime';
import type { AvailableCommand, ByoMessage as RuntimeMessage } from '@clash/web-ui/lib/acpEvents';
import { applyAgentAttribution, parseAgentCanvasPatch } from '@clash/web-ui/lib/agentCanvasPatch';
import type { Node as RFNode, Edge as RFEdge, Connection as RFConnection } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { useAsset, getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { useIsBelowLg } from '@clash/web-ui/lib/hooks/useMediaQuery';
import { useFocusTrap } from '@clash/web-ui/lib/hooks/useFocusTrap';
import { useAgentCopilot, type CustomEvent } from '@clash/web-ui/hooks/useAgentCopilot';
import { getRuntimeConfig, runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import { buildMention } from '@clash/shared-types';


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
    sessionHistory?: Array<CopilotSessionHistoryItem>;
    onNewSession?: () => void;
    onSwitchSession?: (threadId: string) => void;
    onDeleteSession?: (threadId: string) => void;
    onUpsertSession?: (session: CopilotSessionHistoryItem) => void;
    /** Called when user sends first message with no active session */
    onCreateSession?: (initialMessage: string) => void;
    /** Create canvas nodes from already-uploaded attachments */
    onUploadFiles?: (attachments: import('./copilot/ChatInput').UploadedAttachment[]) => void;
    /** Human user represented by the selected local agent. */
    actorUserId?: string;
}

const COPILOT_PANEL_MIN_WIDTH = 420;
const COPILOT_PANEL_MAX_WIDTH_FRACTION = 3 / 7;
const CREATIVE_STATUS_ROTATION_MS = 15_000;
const ACTIVITY_DURATION_MINUTE_MS = 60_000;

function displayErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type CompletedActivity = {
    startedAt: number;
    completedAt: number;
};

function formatActivityDuration(ms: number, t: ReturnType<typeof useTranslation>['t']): string {
    const safeMs = Math.max(0, ms);
    if (safeMs < ACTIVITY_DURATION_MINUTE_MS) {
        return t('copilot.status.workedForSeconds', {
            count: Math.max(1, Math.round(safeMs / 1000)),
        });
    }
    return t('copilot.status.workedForMinutes', {
        count: Math.max(1, Math.round(safeMs / ACTIVITY_DURATION_MINUTE_MS)),
    });
}

type CopilotSessionHistoryItem = {
    id?: string;
    threadId: string;
    title?: string;
    type: 'cloud' | 'runtime';
    projectId?: string;
    runtimeId?: string;
    agentId?: string;
    agentMemberId?: string;
    permissionMode?: string;
    acpSessionId?: string;
    status?: string;
};

function runtimeSessionToHistoryItem(session: RuntimeSessionInfo, title?: string): CopilotSessionHistoryItem {
    return {
        id: session.id,
        threadId: session.threadId,
        title: title ?? session.title,
        type: 'runtime',
        projectId: session.projectId,
        runtimeId: session.runtimeId,
        agentId: session.agentId ?? undefined,
        agentMemberId: session.agentMemberId,
        permissionMode: session.permissionMode,
        acpSessionId: session.acpSessionId,
        status: session.status,
    };
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

const DESKTOP_LOCAL_RUNTIME_ID = 'desktop-local';
const LOCAL_AGENT_PREFERENCE = [
    'codex-acp',
    'claude-acp',
    'gemini',
];

const COPILOT_PANEL_TRANSITION = { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const };
const COPILOT_PANEL_COLLAPSE_TRANSITION = { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const, times: [0, 0.52, 1] };
const COPILOT_LAUNCHER_ENTER_TRANSITION = { duration: 0.24, delay: 0.12, ease: [0.22, 1, 0.36, 1] as const };
const COPILOT_LAUNCHER_EXIT_TRANSITION = { duration: 0.12, ease: [0.25, 1, 0.5, 1] as const };
const COPILOT_PANEL_LAUNCHER_FOCAL_OFFSET_PX = 44;
const COPILOT_PANEL_DESKTOP_TRANSFORM_ORIGIN =
    `calc(100% - ${COPILOT_PANEL_LAUNCHER_FOCAL_OFFSET_PX}px) calc(100% - ${COPILOT_PANEL_LAUNCHER_FOCAL_OFFSET_PX}px)`;
const COPILOT_PANEL_COLLAPSED_DESKTOP_STATE = {
    opacity: [1, 0.76, 0],
    scale: [1, 0.56, 0.08],
    x: [0, 0, 42],
    y: [0, 34, 34],
};
const COPILOT_PANEL_EXPANDED_DESKTOP_STATE = {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
};

function preferredLocalAgentId(agents: Runtime['agents']): string | undefined {
    for (const id of LOCAL_AGENT_PREFERENCE) {
        if (agents.some((agent) => agent.id === id)) return id;
    }
    return agents[0]?.id;
}

function agentDisplayName(agentId?: string | null): string {
    if (!agentId) return 'Agent';
    if (agentId === 'codex-acp') return 'Codex';
    if (agentId === 'claude-acp') return 'Claude';
    if (agentId === 'gemini') return 'Gemini';
    if (agentId === 'mock-acp') return 'Mock ACP';
    return agentId
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

type AcpSelectValue = { value: string; name: string; description?: string | null };
type AcpSelectValueGroup = { id: string; name: string; options: AcpSelectValue[] };

function findAcpSelectConfigOption(
    options: AcpSessionConfigOption[],
    category: 'model' | 'thought_level' | 'mode',
): AcpSessionConfigOption | null {
    return options.find((option) =>
        option.type === 'select' &&
        option.category === category &&
        Array.isArray(option.options)
    ) ?? null;
}

function flattenAcpSelectValues(option?: AcpSessionConfigOption | null): AcpSelectValue[] {
    if (!option?.options) return [];
    return option.options.flatMap((entry) => {
        if ('options' in entry && Array.isArray(entry.options)) return entry.options;
        return [entry as AcpSelectValue];
    }).filter((entry): entry is AcpSelectValue =>
        !!entry &&
        typeof entry.value === 'string' &&
        typeof entry.name === 'string',
    );
}

function defaultPermissionModeForSession(
    sessionModes?: AcpSessionModeState | null,
    modeConfigOption?: AcpSessionConfigOption | null,
): string | null {
    const availableModes = sessionModes?.availableModes ?? [];
    if (sessionModes?.currentModeId && availableModes.some((mode) => mode.id === sessionModes.currentModeId)) {
        return sessionModes.currentModeId;
    }
    if (availableModes.length > 0) return availableModes[0]?.id ?? null;
    const modeValues = flattenAcpSelectValues(modeConfigOption);
    if (modeConfigOption?.currentValue && modeValues.some((value) => value.value === modeConfigOption.currentValue)) {
        return modeConfigOption.currentValue;
    }
    if (modeValues.length > 0) return modeValues[0]?.value ?? null;
    return null;
}

function isPermissionModeValidForSession(
    modeId: string | undefined,
    sessionModes?: AcpSessionModeState | null,
    modeConfigOption?: AcpSessionConfigOption | null,
): modeId is string {
    if (!modeId) return false;
    const availableModes = sessionModes?.availableModes ?? [];
    if (availableModes.length > 0) return availableModes.some((mode) => mode.id === modeId);
    const modeValues = flattenAcpSelectValues(modeConfigOption);
    if (modeValues.length > 0) return modeValues.some((value) => value.value === modeId);
    return false;
}

function resolvePermissionModeForSession(
    savedModeId: string | undefined,
    sessionModes?: AcpSessionModeState | null,
    modeConfigOption?: AcpSessionConfigOption | null,
): string | null {
    if (isPermissionModeValidForSession(savedModeId, sessionModes, modeConfigOption)) return savedModeId;
    return defaultPermissionModeForSession(sessionModes, modeConfigOption);
}

function permissionModeOption(modeId: string | null | undefined): { permissionModeId?: string } {
    return modeId ? { permissionModeId: modeId } : {};
}

function modelValuesForHarness(
    option: AcpSessionConfigOption | null,
    harnessName: string,
): AcpSelectValueGroup[] {
    const values = flattenAcpSelectValues(option);
    if (values.length === 0) return [];
    return [{
        id: harnessName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'harness',
        name: harnessName,
        options: values,
    }];
}

function selectedAcpSelectValue(option?: AcpSessionConfigOption | null): AcpSelectValue | null {
    const values = flattenAcpSelectValues(option);
    return values.find((entry) => entry.value === option?.currentValue) ?? values[0] ?? null;
}

function sessionTitleForHeader(
    threadId: string,
    sessionHistory: CopilotSessionHistoryItem[],
    fallback: string,
): string {
    if (!threadId) return fallback;
    const title = sessionHistory.find((session) => session.threadId === threadId)?.title?.trim();
    if (title === 'New session') return fallback;
    return title || fallback;
}

function normalizedRuntimeSessionTitle(title?: string | null): string | undefined {
    const trimmed = title?.trim();
    if (!trimmed || trimmed === 'New session') return undefined;
    return trimmed;
}

function titleFromRuntimeMessages(messages: RuntimeMessage[]): string | null {
    for (const message of messages) {
        if (message.role !== 'user') continue;
        const textPart = message.parts.find((part) => part.type === 'text');
        const text = textPart?.text?.trim();
        if (!text) continue;
        return text.length > 52 ? `${text.slice(0, 52)}...` : text;
    }
    return null;
}

function labelForMentionNode(node: RFNode): string {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (typeof data.label === 'string' && data.label.trim()) return data.label.trim();
    if (typeof data.name === 'string' && data.name.trim()) return data.name.trim();
    return node.id;
}

function withSelectedNodeMentions(prompt: string, selectedNodes: RFNode[]): string {
    if (selectedNodes.length === 0) return prompt;
    const mentions = selectedNodes
        .filter((node) => !prompt.includes(`node:${node.id}`))
        .map((node) => buildMention(labelForMentionNode(node), node.id));
    if (mentions.length === 0) return prompt;
    const selectedContext = `Selected context: ${mentions.join(' ')}`;
    return prompt ? `${prompt}\n\n${selectedContext}` : selectedContext;
}

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
    onUpsertSession,
    onCreateSession,
    onUploadFiles,
    actorUserId,
}: ChatbotCopilotProps) {
    const { t } = useTranslation();
    const feedback = useAppFeedback();
    const historyMenuId = useId();
    const runtimeMenuId = useId();
    // Below Tailwind's `lg` (1024px), the panel switches to a full-screen
    // sheet over the canvas. Desktop keeps a resizable bottom-right popover.
    const isMobile = useIsBelowLg();
    // ─── UI State ──────────────────────────────────────────────
    const [input, setInput] = useState(() => initialPrompt ?? '');
    const [isResizing, setIsResizing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
    const [suggestions, setSuggestions] = useState<Array<{ label: string; message: string }>>([]);

    // Two transports:
    //   - 'cloud'   : useAgentCopilot (hosted Clash agent, temporarily disabled)
    //   - 'runtime' : useClashRuntime (registered local daemon / clashd)
    const [chatMode, setChatMode] = useState<'cloud' | 'runtime'>('runtime');
    const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
    const [sessionConfigOpen, setSessionConfigOpen] = useState(false);
    const [sessionHarnessId, setSessionHarnessId] = useState<string | null>(null);
    const [sessionPermissionModeByAgentId, setSessionPermissionModeByAgentId] = useState<Record<string, string>>({});
    const [authenticatingHarnessId, setAuthenticatingHarnessId] = useState<string | null>(null);
    const [addMachineOpen, setAddMachineOpen] = useState(false);
    /** When set, the runtime picker dialog is open for this runtime. */
    const [runtimePicker, setRuntimePicker] = useState<Runtime | null>(null);
    const clashRt = useClashRuntime();
    const slashCommandQuery = useMemo(() => {
        if (chatMode === 'cloud') return null;
        if (!input.startsWith('/')) return null;
        const query = input.slice(1);
        if (/\s/.test(query)) return null;
        return query.toLowerCase();
    }, [chatMode, input]);
    const slashCommandOptions = useMemo(() => {
        if (slashCommandQuery === null) return [];
        return (clashRt.availableCommands ?? [])
            .filter((command) => {
                const name = normalizeSlashCommandName(command);
                if (!name) return false;
                if (slashCommandQuery.length === 0) return true;
                return name.toLowerCase().startsWith(slashCommandQuery);
            })
            .slice(0, 12);
    }, [clashRt.availableCommands, slashCommandQuery]);
    const handlePickSlashCommand = useCallback((command: AvailableCommand) => {
        const name = normalizeSlashCommandName(command);
        if (!name) return;
        setInput(`/${name} `);
    }, []);
    const isDesktopLocalMode = useMemo(() => getRuntimeConfig().mode === 'desktop', []);
    const desktopLocalRuntime = useMemo(
        () => clashRt.runtimes.find((rt) => rt.id === DESKTOP_LOCAL_RUNTIME_ID) ?? null,
        [clashRt.runtimes],
    );
    const selectedRuntimeForSession = useMemo(
        () => (chatMode === 'runtime'
            ? clashRt.runtimes.find((rt) => rt.id === clashRt.selectedRuntimeId) ?? desktopLocalRuntime
            : null),
        [chatMode, clashRt.runtimes, clashRt.selectedRuntimeId, desktopLocalRuntime],
    );
    const sessionHarnessOptions = selectedRuntimeForSession?.agents ?? [];
    const effectiveSessionHarnessId =
        sessionHarnessId ??
        clashRt.selectedAgentId ??
        preferredLocalAgentId(sessionHarnessOptions) ??
        null;
    const selectedSessionHarness = useMemo(
        () => sessionHarnessOptions.find((agent) => agent.id === effectiveSessionHarnessId) ?? null,
        [effectiveSessionHarnessId, sessionHarnessOptions],
    );
    const selectedSessionHarnessAuth = selectedSessionHarness?.auth?.status === 'needs-auth'
        ? selectedSessionHarness.auth
        : null;
    const selectedSessionHarnessAuthTitle = selectedSessionHarnessAuth && effectiveSessionHarnessId
        ? `Sign in to ${agentDisplayName(effectiveSessionHarnessId)}`
        : null;
    const selectedSessionHarnessAuthMessage = selectedSessionHarnessAuth?.message ?? null;
    const effectiveSessionConfigOptions = useMemo(() => {
        const agentConfigOptions = selectedSessionHarness?.config_options ?? [];
        if (clashRt.selectedAgentId === effectiveSessionHarnessId && clashRt.sessionConfigOptions.length > 0) {
            return clashRt.sessionConfigOptions;
        }
        if (agentConfigOptions.length > 0) return agentConfigOptions;
        if (selectedSessionHarness) return [];
        return clashRt.sessionConfigOptions;
    }, [
        clashRt.selectedAgentId,
        clashRt.sessionConfigOptions,
        effectiveSessionHarnessId,
        selectedSessionHarness?.config_options,
    ]);
    const effectiveSessionModes = useMemo(() => {
        if (clashRt.selectedAgentId === effectiveSessionHarnessId && clashRt.sessionModes) {
            return clashRt.sessionModes;
        }
        return selectedSessionHarness?.session_modes ?? null;
    }, [
        clashRt.selectedAgentId,
        clashRt.sessionModes,
        effectiveSessionHarnessId,
        selectedSessionHarness?.session_modes,
    ]);
    const modelConfigOption = useMemo(
        () => findAcpSelectConfigOption(effectiveSessionConfigOptions, 'model'),
        [effectiveSessionConfigOptions],
    );
    const thoughtLevelConfigOption = useMemo(
        () => findAcpSelectConfigOption(effectiveSessionConfigOptions, 'thought_level'),
        [effectiveSessionConfigOptions],
    );
    const modeConfigOption = useMemo(
        () => findAcpSelectConfigOption(effectiveSessionConfigOptions, 'mode'),
        [effectiveSessionConfigOptions],
    );
    const sessionPermissionModeId = useMemo(() => {
        if (!effectiveSessionHarnessId) return defaultPermissionModeForSession(effectiveSessionModes, modeConfigOption);
        return resolvePermissionModeForSession(
            sessionPermissionModeByAgentId[effectiveSessionHarnessId],
            effectiveSessionModes,
            modeConfigOption,
        );
    }, [effectiveSessionHarnessId, effectiveSessionModes, modeConfigOption, sessionPermissionModeByAgentId]);
    const setSessionPermissionModeForAgent = useCallback((agentId: string | null | undefined, modeId: string) => {
        if (!agentId) return;
        setSessionPermissionModeByAgentId((prev) => (
            prev[agentId] === modeId ? prev : { ...prev, [agentId]: modeId }
        ));
    }, []);
    const runtimeTitle = useMemo(
        () => titleFromRuntimeMessages(clashRt.messages) ?? normalizedRuntimeSessionTitle(clashRt.currentSession?.title),
        [clashRt.currentSession?.title, clashRt.messages],
    );
    const runtimeHistoryItem = useMemo<CopilotSessionHistoryItem | null>(() => {
        if (chatMode !== 'runtime' || !clashRt.currentSession) return null;
        return runtimeSessionToHistoryItem(clashRt.currentSession, runtimeTitle);
    }, [chatMode, clashRt.currentSession, runtimeTitle]);
    const visibleSessionHistory = useMemo<CopilotSessionHistoryItem[]>(() => {
        if (!runtimeHistoryItem) return sessionHistory;
        if (sessionHistory.some((session) => session.threadId === runtimeHistoryItem.threadId)) return sessionHistory;
        return [runtimeHistoryItem, ...sessionHistory];
    }, [runtimeHistoryItem, sessionHistory]);
    const hasThreadInHistory = Boolean(threadId && visibleSessionHistory.some((session) => session.threadId === threadId));
    const activeSessionId = chatMode === 'runtime'
        ? clashRt.currentSession?.threadId ?? (hasThreadInHistory ? threadId : '')
        : threadId;
    const sessionHarnessLocked = chatMode === 'runtime' && Boolean(clashRt.currentSession || clashRt.sessionId || clashRt.ready);
    const panelTitle = sessionTitleForHeader(
        activeSessionId,
        visibleSessionHistory,
        chatMode === 'runtime' ? t('copilot.header.newChat') : t('copilot.panel.label'),
    );

    useEffect(() => {
        if (chatMode !== 'runtime' || !clashRt.currentSession || !onUpsertSession) return;
        onUpsertSession(runtimeSessionToHistoryItem(clashRt.currentSession, runtimeTitle));
    }, [chatMode, clashRt.currentSession, onUpsertSession, runtimeTitle]);

    useEffect(() => {
        if (sessionHarnessOptions.length === 0) return;
        if (effectiveSessionHarnessId && sessionHarnessOptions.some((agent) => agent.id === effectiveSessionHarnessId)) return;
        setSessionHarnessId(preferredLocalAgentId(sessionHarnessOptions) ?? null);
    }, [effectiveSessionHarnessId, sessionHarnessOptions]);

    const handleSelectSessionHarness = useCallback((agentId: string) => {
        if (sessionHarnessLocked) return;
        setSessionHarnessId(agentId);
        const pickedAgent = sessionHarnessOptions.find((agent) => agent.id === agentId);
        if (pickedAgent?.auth?.status === 'needs-auth') {
            setSessionError(null);
            void clashRt.refresh({ probe: 'config', refresh: true }).catch((error) => {
                feedback.notify({
                    variant: 'error',
                    title: 'Could not check agent auth',
                    message: displayErrorMessage(error),
                    actionLabel: 'Open Runtimes',
                    actionHref: '/settings?section=runtimes',
                });
            });
            return;
        }
        const nextModeConfigOption = findAcpSelectConfigOption(pickedAgent?.config_options ?? [], 'mode');
        const nextPermissionModeId = resolvePermissionModeForSession(
            sessionPermissionModeByAgentId[agentId],
            pickedAgent?.session_modes ?? null,
            nextModeConfigOption,
        );
        if (nextPermissionModeId) setSessionPermissionModeForAgent(agentId, nextPermissionModeId);
        const runtime = selectedRuntimeForSession ?? desktopLocalRuntime;
        if (chatMode === 'runtime' && runtime?.status === 'online') {
            const sessionOptions = {
                projectId,
                agentId,
                ...permissionModeOption(nextPermissionModeId),
            };
            if (clashRt.ready) {
                void clashRt.select(runtime.id, undefined, sessionOptions);
            } else {
                clashRt.startDraft(runtime.id, undefined, sessionOptions);
            }
        }
    }, [
        chatMode,
        clashRt.select,
        clashRt.ready,
        clashRt.refresh,
        clashRt.startDraft,
        desktopLocalRuntime,
        projectId,
        selectedRuntimeForSession,
        sessionHarnessLocked,
        sessionHarnessOptions,
        sessionPermissionModeByAgentId,
        setSessionPermissionModeForAgent,
        feedback,
    ]);

    const handleSelectSessionConfigOption = useCallback((configId: string, value: string | boolean) => {
        clashRt.setConfigOption(configId, value);
    }, [clashRt.setConfigOption]);

    const handleAuthenticateSessionHarness = useCallback(async () => {
        if (!effectiveSessionHarnessId) return;
        const label = selectedSessionHarness?.label ?? agentDisplayName(effectiveSessionHarnessId);
        setAuthenticatingHarnessId(effectiveSessionHarnessId);
        setSessionError(null);
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/local/harnesses/${encodeURIComponent(effectiveSessionHarnessId)}/authenticate`), {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? `HTTP ${res.status}`);
            }
            await clashRt.refresh({ probe: 'config', refresh: true });
            feedback.notify({
                variant: 'info',
                title: `${label} sign in opened`,
                message: 'Finish authentication, then check again.',
                actionLabel: 'Check again',
                onAction: () => {
                    void clashRt.refresh({ probe: 'config', refresh: true });
                },
            });
        } catch (e) {
            feedback.notify({
                variant: 'error',
                title: `Could not start ${label} sign in`,
                message: displayErrorMessage(e),
                actionLabel: 'Check again',
                onAction: () => {
                    void clashRt.refresh({ probe: 'config', refresh: true });
                },
            });
        } finally {
            setAuthenticatingHarnessId(null);
        }
    }, [clashRt.refresh, effectiveSessionHarnessId, feedback, selectedSessionHarness?.label]);

    const handleRecheckSessionHarness = useCallback(async () => {
        setSessionError(null);
        try {
            await clashRt.refresh({ probe: 'config', refresh: true });
        } catch (error) {
            feedback.notify({
                variant: 'error',
                title: 'Could not check agent auth',
                message: displayErrorMessage(error),
                actionLabel: 'Open Runtimes',
                actionHref: '/settings?section=runtimes',
            });
        }
    }, [clashRt.refresh, feedback]);

    const handleSelectSessionPermissionMode = useCallback((modeId: string) => {
        const runtime = selectedRuntimeForSession ?? desktopLocalRuntime;
        const agentId = effectiveSessionHarnessId ?? preferredLocalAgentId(runtime?.agents ?? []);
        if (!agentId) return;
        setSessionPermissionModeForAgent(agentId, modeId);

        if (effectiveSessionModes) {
            clashRt.setSessionMode(modeId);
            if (chatMode === 'runtime' && runtime?.status === 'online' && !clashRt.ready && clashRt.status !== 'draft') {
                clashRt.startDraft(runtime.id, undefined, {
                    projectId,
                    agentId,
                    ...permissionModeOption(modeId),
                });
            }
            return;
        }

        if (modeConfigOption && clashRt.ready) {
            clashRt.setConfigOption(modeConfigOption.id, modeId);
            return;
        }
        if (modeConfigOption && clashRt.status === 'draft') {
            clashRt.setConfigOption(modeConfigOption.id, modeId);
        }
        if (chatMode === 'runtime' && runtime?.status === 'online') {
            const sessionOptions = {
                projectId,
                agentId,
                ...permissionModeOption(modeId),
            };
            if (clashRt.ready) {
                void clashRt.select(runtime.id, undefined, sessionOptions);
            } else {
                clashRt.startDraft(runtime.id, undefined, sessionOptions);
            }
        }
    }, [
        chatMode,
        clashRt.select,
        clashRt.ready,
        clashRt.setConfigOption,
        clashRt.setSessionMode,
        clashRt.startDraft,
        clashRt.status,
        desktopLocalRuntime,
        effectiveSessionHarnessId,
        effectiveSessionModes,
        modeConfigOption,
        projectId,
        selectedRuntimeForSession,
        setSessionPermissionModeForAgent,
    ]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const scrollFrameRef = useRef<number | null>(null);
    const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
    const updateStickToBottom = useCallback((next: boolean) => {
        stickToBottomRef.current = next;
        setShouldStickToBottom(next);
    }, []);
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
        enabled: chatMode === 'cloud',
        onCustomEvent: useCallback((data: Record<string, unknown>) => {
            if (data.type === 'suggestions' && Array.isArray(data.suggestions)) {
                setSuggestions(data.suggestions as Array<{ label: string; message: string }>);
            }
        }, []),
    });

    useEffect(() => {
        if (!isDesktopLocalMode || chatMode !== 'runtime') return;
        if (clashRt.selectedRuntimeId || clashRt.ready || clashRt.status === 'connecting') return;
        const runtime = desktopLocalRuntime;
        if (!runtime || runtime.status !== 'online' || runtime.agents.length === 0) return;
        clashRt.startDraft(runtime.id, undefined, {
            projectId,
            agentId: preferredLocalAgentId(runtime.agents),
            ...permissionModeOption(sessionPermissionModeId),
        });
    }, [
        chatMode,
        clashRt.ready,
        clashRt.selectedRuntimeId,
        clashRt.startDraft,
        clashRt.status,
        desktopLocalRuntime,
        isDesktopLocalMode,
        projectId,
        sessionPermissionModeId,
    ]);

    const cloudIsProcessing = status === 'submitted' || status === 'streaming';
    const runtimeIsConnecting = clashRt.status === 'connecting';
    const runtimeTurnIsProcessing =
        clashRt.status === 'sending' ||
        clashRt.status === 'streaming' ||
        (clashRt.status === 'connecting' && clashRt.messages.length > 0);
    const isProcessing =
        chatMode === 'runtime' ? runtimeTurnIsProcessing :
        cloudIsProcessing;
    const showRuntimeConnectingStatus =
        chatMode === 'runtime' && runtimeIsConnecting && !isDesktopLocalMode;
    const showProcessingIndicator =
        chatMode === 'runtime'
            ? clashRt.messages.length > 0 && runtimeTurnIsProcessing
            : isProcessing;
    const processingIndicatorMessage =
        chatMode === 'runtime'
            ? t(clashRt.status === 'sending' ? 'copilot.status.thinking' : 'copilot.status.streaming')
            : t(status === 'submitted' ? 'copilot.status.thinking' : 'copilot.status.streaming');
    const creativeStatusKey = showProcessingIndicator
        ? (chatMode === 'runtime'
            ? (clashRt.status === 'sending' ? 'copilot.status.creativeThinking' : 'copilot.status.creativeStreaming')
            : (status === 'submitted' ? 'copilot.status.creativeThinking' : 'copilot.status.creativeStreaming'))
        : null;
    const [creativeStatusIndex, setCreativeStatusIndex] = useState(0);
    const creativeStatusMessages = useMemo(() => {
        if (!creativeStatusKey) {
            return [] as string[];
        }
        const messages = t(creativeStatusKey, { returnObjects: true });
        return Array.isArray(messages) && messages.length > 0
            ? messages.map((message) => String(message)).filter(Boolean)
            : [processingIndicatorMessage];
    }, [creativeStatusKey, processingIndicatorMessage, t]);
    useEffect(() => {
        setCreativeStatusIndex(0);
        if (!creativeStatusKey || creativeStatusMessages.length <= 1) return;
        const interval = window.setInterval(() => {
            setCreativeStatusIndex((index) => (index + 1) % creativeStatusMessages.length);
        }, CREATIVE_STATUS_ROTATION_MS);
        return () => window.clearInterval(interval);
    }, [creativeStatusKey, creativeStatusMessages.length]);
    const creativeStatusLabel = creativeStatusKey
        ? (creativeStatusMessages[creativeStatusIndex % Math.max(creativeStatusMessages.length, 1)] ?? processingIndicatorMessage)
        : null;
    const activeTurnStartedAtRef = useRef<number | null>(null);
    const [lastCompletedActivity, setLastCompletedActivity] = useState<CompletedActivity | null>(null);
    const activitySessionScopeRef = useRef<string | null>(null);
    useEffect(() => {
        if (showProcessingIndicator) {
            if (activeTurnStartedAtRef.current === null) {
                activeTurnStartedAtRef.current = Date.now();
            }
            setLastCompletedActivity(null);
            return;
        }
        if (activeTurnStartedAtRef.current !== null) {
            const completedActivity = {
                startedAt: activeTurnStartedAtRef.current,
                completedAt: Date.now(),
            };
            setLastCompletedActivity(completedActivity);
            activeTurnStartedAtRef.current = null;
        }
    }, [showProcessingIndicator]);
    useEffect(() => {
        const nextScope = chatMode === 'runtime' ? clashRt.sessionId : threadId;
        const previousScope = activitySessionScopeRef.current;
        activitySessionScopeRef.current = nextScope;
        if (previousScope === null || previousScope === nextScope) return;
        activeTurnStartedAtRef.current = null;
        setLastCompletedActivity(null);
    }, [chatMode, clashRt.sessionId, threadId]);
    const pendingCompletedActivityLabel = !showProcessingIndicator && activeTurnStartedAtRef.current !== null
        ? formatActivityDuration(Date.now() - activeTurnStartedAtRef.current, t)
        : null;
    const completedActivityLabel = pendingCompletedActivityLabel
        ?? (lastCompletedActivity
            ? formatActivityDuration(lastCompletedActivity.completedAt - lastCompletedActivity.startedAt, t)
            : null);
    const runtimeTransientStatusLabel = useMemo(() => {
        if (chatMode !== 'runtime' || !clashRt.transientStatus) return null;
        const status = clashRt.transientStatus;
        const label = status.kind === 'reconnecting'
            ? t('copilot.status.reconnecting', {
                attempt: status.attempt ?? 0,
                maxAttempts: status.maxAttempts ?? 0,
            })
            : t('copilot.status.switchingTransport');
        return status.detail ? `${label} · ${status.detail}` : label;
    }, [chatMode, clashRt.transientStatus, t]);
    const activityStatusLabel =
        runtimeTransientStatusLabel ??
        creativeStatusLabel ??
        completedActivityLabel ??
        (showProcessingIndicator ? processingIndicatorMessage : null);
    const showRuntimeActivityRow =
        chatMode === 'runtime' && (!!runtimeTransientStatusLabel || showProcessingIndicator || !!completedActivityLabel);
    const showCloudActivityRow =
        chatMode === 'cloud' && !!activityStatusLabel && (showProcessingIndicator || !!completedActivityLabel);
    const acpGlobalState = useMemo(() => getAcpGlobalState(clashRt.messages), [clashRt.messages]);
    const visibleRuntimeUserTurnIds = useMemo(() => {
        const turnIds = new Set<string>();
        for (const message of clashRt.messages) {
            if (message.role !== 'user' || !message.id.startsWith('user-')) continue;
            turnIds.add(message.id.slice('user-'.length));
        }
        return turnIds;
    }, [clashRt.messages]);
    const visibleRuntimePromptQueue = useMemo(
        () => clashRt.promptQueue.filter((item) => !visibleRuntimeUserTurnIds.has(item.turnId)),
        [clashRt.promptQueue, visibleRuntimeUserTurnIds],
    );
    const runtimeAlertMessage = chatMode === 'runtime' && !isDesktopLocalMode ? clashRt.errorMessage : null;
    const desktopLocalSetupIssue = chatMode === 'runtime' && isDesktopLocalMode ? clashRt.errorMessage : null;
    const showRuntimeComposerCompanion =
        chatMode === 'runtime' &&
        clashRt.messages.length === 0 &&
        !desktopLocalSetupIssue &&
        (showRuntimeActivityRow || (isDesktopLocalMode && (clashRt.status === 'draft' || clashRt.ready)));

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

                    const data = applyAgentAttribution(patchNode.data, {
                        actorUserId,
                        actorAgentId: clashRt.selectedAgentId ?? undefined,
                    });

                    onAddNode(patchNode.type, {
                        id: patchNode.id,
                        ...data,
                        ...(patchNode.position ? { position: patchNode.position } : {}),
                        ...(patchNode.parentId ? { parentId: patchNode.parentId } : {}),
                        ...(patchNode.width !== undefined ? { width: patchNode.width } : {}),
                        ...(patchNode.height !== undefined ? { height: patchNode.height } : {}),
                        ...(patchNode.style ? { style: patchNode.style } : {}),
                    });
                }
            }
        }
    }, [actorUserId, chatMode, clashRt.messages, clashRt.selectedAgentId, onAddNode]);

    // Mount-time send of the pending first message. Parent gives us a fresh
    // `key={threadId}` whenever the session changes, so this component remounts
    // cleanly on every session change — no useChat id-transition race, no
    // module-level pending state. queueMessageOnOpen waits for the WS handshake
    // to land before firing; subsequent sends just hit `sendMessage` directly.
    const initialMessageRef = useRef(initialPrompt);
    useEffect(() => {
        const msg = initialMessageRef.current;
        if (chatMode === 'cloud' && msg && threadId) queueMessageOnOpen(msg);
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
    const [waitingFirstSend, setWaitingFirstSend] = useState(chatMode === 'cloud' && !!initialPrompt);
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
        const runtime = selectedRuntimeForSession ?? desktopLocalRuntime;
        if (chatMode === 'runtime' && runtime?.status === 'online') {
            clashRt.startDraft(runtime.id, undefined, {
                projectId,
                agentId: effectiveSessionHarnessId ?? preferredLocalAgentId(runtime.agents),
                ...permissionModeOption(sessionPermissionModeId),
                freshSession: true,
            });
            return;
        }
        onNewSession?.();
    }, [
        chatMode,
        clashRt.startDraft,
        clearCustomEvents,
        desktopLocalRuntime,
        effectiveSessionHarnessId,
        onNewSession,
        projectId,
        selectedRuntimeForSession,
        sessionPermissionModeId,
    ]);

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

    const selectHistoryItem = useCallback((item: CopilotSessionHistoryItem) => {
        if (item.type === 'runtime' && item.runtimeId) {
            const nextAgentId = item.agentId ?? effectiveSessionHarnessId ?? null;
            if (nextAgentId) setSessionHarnessId(nextAgentId);
            if (item.permissionMode) setSessionPermissionModeForAgent(nextAgentId, item.permissionMode);
            setChatMode('runtime');
            void clashRt.attachSession({
                id: item.id ?? item.threadId,
                threadId: item.threadId,
                title: item.title,
                type: 'runtime',
                projectId: item.projectId ?? projectId,
                runtimeId: item.runtimeId,
                agentId: nextAgentId,
                ...(item.agentMemberId ? { agentMemberId: item.agentMemberId } : {}),
                permissionMode: item.permissionMode,
                acpSessionId: item.acpSessionId,
                status: item.status,
            });
        } else {
            onSwitchSession?.(item.threadId);
        }
        setShowHistory(false);
        historyButtonRef.current?.focus();
    }, [clashRt.attachSession, effectiveSessionHarnessId, onSwitchSession, projectId, setSessionPermissionModeForAgent]);

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
        if (!stickToBottomRef.current) return;
        if (scrollFrameRef.current !== null) return;
        const scheduleFrame = typeof globalThis.requestAnimationFrame === 'function'
            ? globalThis.requestAnimationFrame.bind(globalThis)
            : ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0));
        scrollFrameRef.current = scheduleFrame(() => {
            scrollFrameRef.current = null;
            if (!stickToBottomRef.current) return;
            const container = scrollContainerRef.current;
            if (!container) return;
            container.scrollTop = container.scrollHeight;
        });
    }, []);

    useEffect(() => {
        return () => {
            if (scrollFrameRef.current === null) return;
            const cancelFrame = typeof globalThis.cancelAnimationFrame === 'function'
                ? globalThis.cancelAnimationFrame.bind(globalThis)
                : window.clearTimeout.bind(window);
            cancelFrame(scrollFrameRef.current);
            scrollFrameRef.current = null;
        };
    }, []);

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
            ([entry]) => updateStickToBottom(entry.isIntersecting),
            { root: container, rootMargin: '0px 0px 120px 0px', threshold: 0 },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [isCollapsed, updateStickToBottom]);

    useEffect(() => {
        if (isCollapsed) return;
        scrollToBottom();
    }, [chatMode, clashRt.messages, isCollapsed, messages, shouldStickToBottom, scrollToBottom]);

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
    const [editingQueuedTurnId, setEditingQueuedTurnId] = useState<string | null>(null);
    const agentMotionState: AgentMotionState =
        runtimeAlertMessage || desktopLocalSetupIssue || sessionError
            ? 'failed'
            : showProcessingIndicator
                ? 'working'
                : chatMode === 'runtime' && !clashRt.ready && (clashRt.status === 'idle' || clashRt.status === 'connecting')
                    ? 'connecting'
                    : suggestions.length > 0
                        ? 'waiting'
                        : clashRt.ready && clashRt.messages.length > 0
                            ? 'review'
                            : 'idle';

    const handleSubmit = async (text: string, attachments: import('./copilot/ChatInput').UploadedAttachment[] = []) => {
        const value = text.trim();
        if (!value && attachments.length === 0) return;
        if ((chatMode !== 'runtime' && isProcessing) || isCreatingSession) return;
        if (chatMode === 'runtime' && editingQueuedTurnId) {
            clashRt.updateQueuedPrompt(editingQueuedTurnId, value);
            setEditingQueuedTurnId(null);
            setInput('');
            return;
        }
        setSuggestions([]);
        setSessionError(null);
        clearConnectionError();
        updateStickToBottom(true);

        // Persistent-runtime mode: raw prompt, daemon handles the local ACP session.
        if (chatMode === 'runtime') {
            const runtimePrompt = withSelectedNodeMentions(value, selectedNodes);
            if (selectedSessionHarnessAuth) {
                setInput(runtimePrompt);
                return;
            }
            if (!clashRt.ready) {
                const runtime = selectedRuntimeForSession ?? desktopLocalRuntime;
                if (isDesktopLocalMode && runtime && runtime.status === 'online' && runtime.agents.length > 0) {
                    if (!clashRt.selectedRuntimeId || clashRt.status === 'idle' || clashRt.status === 'disconnected') {
                        clashRt.startDraft(runtime.id, undefined, {
                            projectId,
                            agentId: effectiveSessionHarnessId ?? preferredLocalAgentId(runtime.agents),
                            ...permissionModeOption(sessionPermissionModeId),
                        });
                    }
                } else if (isDesktopLocalMode) {
                    setInput(runtimePrompt);
                    void clashRt.refresh();
                    return;
                } else {
                    setInput(runtimePrompt);
                    setSessionError(t('copilot.status.localRuntimeRequired'));
                    return;
                }
            }
            setInput('');
            clashRt.sendMessage(runtimePrompt);
            return;
        }

        setInput('');

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
            const maxWidth = Math.max(COPILOT_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * COPILOT_PANEL_MAX_WIDTH_FRACTION));
            pendingX = null;
            onWidthChange(Math.max(COPILOT_PANEL_MIN_WIDTH, Math.min(maxWidth, newWidth)));
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
                        initial={{ opacity: 0, scale: 0.86, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0, transition: COPILOT_LAUNCHER_ENTER_TRANSITION }}
                        exit={{ opacity: 0, scale: 0.92, y: 6, transition: COPILOT_LAUNCHER_EXIT_TRANSITION }}
                        onClick={() => onCollapseChange(false)}
                        aria-label={t('copilot.panel.expand')}
                        aria-expanded={false}
                        aria-controls="clash-copilot-panel"
                        // Clears the iPhone home-indicator gesture zone with safe-area-inset-bottom
                        // while keeping the same bottom-right launcher position on desktop.
                        className="clash-copilot-launcher fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex h-20 w-20 items-center justify-center rounded-[26px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                        whileHover={{ scale: 1.035, y: -1 }}
                        whileTap={{ scale: 0.965 }}
                    >
                        <AgentMotion state="idle" className="h-16 w-16" />
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
                        : `clash-copilot-panel-shell fixed bottom-3 right-3 z-50 flex flex-col overflow-hidden rounded-matrix bg-warm-surface ${isCollapsed ? 'pointer-events-none' : 'pointer-events-auto'}`
                }
                style={isMobile ? undefined : {
                    width: `${width}px`,
                    height: 'calc(100dvh - var(--clash-desktop-chrome-height, 0px) - 1.5rem)',
                    transformOrigin: COPILOT_PANEL_DESKTOP_TRANSFORM_ORIGIN,
                }}
                animate={
                    isMobile
                        ? { x: isCollapsed ? '100%' : 0 }
                        : isCollapsed
                            ? COPILOT_PANEL_COLLAPSED_DESKTOP_STATE
                            : COPILOT_PANEL_EXPANDED_DESKTOP_STATE
                }
                initial={false}
                transition={isResizing ? { duration: 0 } : isCollapsed && !isMobile ? COPILOT_PANEL_COLLAPSE_TRANSITION : COPILOT_PANEL_TRANSITION}
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
                        className={`clash-copilot-resize-handle absolute -left-1 top-8 bottom-8 z-10 w-2 cursor-ew-resize rounded-full ${isResizing ? 'is-resizing' : ''}`}
                    />
                )}

                <AnimatePresence>
                    {!isCollapsed && (
                        <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.99 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.99 }}
                            transition={COPILOT_PANEL_TRANSITION}
                            className="h-full flex flex-col relative"
                        >
                            <div className="clash-copilot-panel-header relative z-20 flex shrink-0 items-center gap-2 px-6 py-3">
                                <CopilotRailSlot ariaHidden={false}>
                                    <IconButton
                                        onClick={() => onCollapseChange(true)}
                                        label={t('copilot.panel.collapse')}
                                        aria-expanded={true}
                                        aria-controls="clash-copilot-panel"
                                        size="sm"
                                        icon={<CaretRight className="w-4 h-4" weight="bold" />}
                                        className="h-8 w-8 text-stone-700 dark:text-stone-300"
                                    />
                                </CopilotRailSlot>

                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-display text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                                        {panelTitle}
                                    </div>
                                </div>

                                <div className="flex translate-x-1 items-center gap-1" role="toolbar" aria-label={t('copilot.panel.label')}>
                                    <AcpProgressPanel
                                        planEntries={acpGlobalState.planEntries}
                                        outputs={acpGlobalState.outputs}
                                        className="shrink-0"
                                    />
                                    <IconButton
                                        onClick={handleNewSession}
                                        label={t('copilot.header.newSession')}
                                        size="sm"
                                        icon={<Plus className="w-4 h-4" weight="bold" />}
                                    />
                                    <DropdownMenu open={showHistory} onOpenChange={setShowHistory}>
                                        <DropdownMenuTrigger asChild>
                                            <IconButton
                                                ref={historyButtonRef}
                                                label={t('copilot.header.history')}
                                                aria-expanded={showHistory}
                                                aria-controls={historyMenuId}
                                                aria-haspopup="menu"
                                                size="sm"
                                                className="relative"
                                                icon={
                                                    <>
                                                        <ClockCounterClockwise className="w-4 h-4" weight="bold" />
                                                        {visibleSessionHistory.length > 0 && (
                                                            <span className="absolute top-1 right-1 w-2 h-2 bg-brand rounded-full border border-warm-surface" />
                                                        )}
                                                    </>
                                                }
                                            />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            id={historyMenuId}
                                            aria-label={t('copilot.history.title')}
                                            align="end"
                                            side="bottom"
                                            className="max-h-[320px] w-72 overflow-y-auto"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <div className="space-y-0.5">
                                                {visibleSessionHistory.length === 0 ? (
                                                    <div className="px-3 py-3 text-center text-sm text-slate-700 dark:text-slate-300">
                                                        {t('copilot.history.empty')}
                                                    </div>
                                                ) : (
                                                    visibleSessionHistory.map((item, index) => (
                                                        <div key={item.threadId} className="group flex items-center gap-1">
                                                            <DropdownMenuItem
                                                                aria-label={`${item.title || t('copilot.history.fallbackTitle', { index: index + 1 })} ${item.threadId.slice(-6)}`}
                                                                onSelect={() => selectHistoryItem(item)}
                                                                className="min-h-[48px] flex-1"
                                                            >
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block truncate font-medium leading-5">
                                                                        {item.title || t('copilot.history.fallbackTitle', { index: index + 1 })}
                                                                    </span>
                                                                    <span className="block truncate font-mono text-[11px] font-normal leading-4 text-stone-600 dark:text-stone-400">
                                                                        {item.threadId.slice(-6)}
                                                                    </span>
                                                                </span>
                                                            </DropdownMenuItem>
                                                            {onDeleteSession && (
                                                                <IconButton
                                                                    onClick={(e) => deleteSession(item.threadId, e)}
                                                                    label={t('copilot.history.delete')}
                                                                    variant="destructive"
                                                                    size="sm"
                                                                    icon={<Trash className="w-3.5 h-3.5" />}
                                                                    className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                                />
                                                            )}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    {!isDesktopLocalMode && (
                                        <div className="relative">
                                            <DropdownMenu
                                                open={runtimeMenuOpen}
                                                onOpenChange={(open) => {
                                                    if (open) void clashRt.refresh();
                                                    setRuntimeMenuOpen(open);
                                                }}
                                            >
                                                <DropdownMenuTrigger asChild>
                                                    <IconButton
                                                        label={t('copilot.header.runOn')}
                                                        aria-expanded={runtimeMenuOpen}
                                                        aria-controls={runtimeMenuId}
                                                        aria-haspopup="menu"
                                                        variant={chatMode !== 'cloud' ? 'active' : 'default'}
                                                        icon={<Plug className="w-5 h-5" weight="bold" />}
                                                    />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                    id={runtimeMenuId}
                                                    aria-label={t('copilot.runtime.menuTitle')}
                                                    align="end"
                                                    side="bottom"
                                                    className="w-72"
                                                >
                                                    <div className="px-3 pb-1 pt-1 text-sm font-medium text-stone-500 dark:text-stone-400">
                                                        {t('copilot.runtime.menuTitle')}
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <RuntimeMenuRow
                                                            label={t('copilot.runtime.cloud.label')}
                                                            sub={t('copilot.runtime.cloud.sub')}
                                                            active={chatMode === 'cloud'}
                                                            disabled
                                                            onSelect={() => setRuntimeMenuOpen(false)}
                                                        />
                                                        {clashRt.runtimes.length > 0 && (
                                                            <div role="presentation" className="px-3 pt-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                                                                {t('copilot.runtime.machinesHeader')}
                                                            </div>
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
                                                                    onSelect={() => {
                                                                        // Open the daemon picker so runtime sessions keep
                                                                        // the same agent + resume-session UX.
                                                                        setRuntimeMenuOpen(false);
                                                                        setRuntimePicker(rt);
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                        <div role="separator" className="my-1.5 border-t border-warm-border/80 dark:border-slate-700" />
                                                        <RuntimeMenuRow
                                                            label={t('copilot.runtime.addMachine.label')}
                                                            sub={t('copilot.runtime.addMachine.sub')}
                                                            onSelect={() => {
                                                                setRuntimeMenuOpen(false);
                                                                setAddMachineOpen(true);
                                                            }}
                                                        />
                                                    </div>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div
                                ref={scrollContainerRef}
                                className="relative flex-1 min-h-0 overflow-y-auto px-4 pt-10 pb-40 sm:px-6"
                            >
                                <div className="space-y-3">
                                    {/* Runtime mode produces the local ACP message shape.
                                        Cloud renders the heavier UIMessage path. */}
                                    {chatMode === 'runtime' && (
                                        <>
                                            {showRuntimeConnectingStatus && (
                                                <div role="status" aria-live="polite" className="text-xs text-stone-600 italic dark:text-stone-300">{t('copilot.status.connecting')}</div>
                                            )}
                                            {runtimeAlertMessage && (
                                                <div role="alert" className="text-sm text-red-700 dark:text-red-300">{t('copilot.errors.warningPrefix')} {runtimeAlertMessage}</div>
                                            )}
                                            {selectedSessionHarnessAuthTitle && selectedSessionHarnessAuth && (
                                                <RuntimeAuthNotice
                                                    title={selectedSessionHarnessAuthTitle}
                                                    message={selectedSessionHarnessAuthMessage ?? ''}
                                                    command={selectedSessionHarnessAuth?.command}
                                                    busy={authenticatingHarnessId === effectiveSessionHarnessId}
                                                    onAuthenticate={handleAuthenticateSessionHarness}
                                                    onRecheck={handleRecheckSessionHarness}
                                                />
                                            )}
                                            <RuntimeMessageList
                                                messages={clashRt.messages}
                                                ready={clashRt.ready}
                                                desktopLocalMode={isDesktopLocalMode}
                                                localRuntime={desktopLocalRuntime}
                                                setupIssue={desktopLocalSetupIssue}
                                                status={clashRt.status}
                                                activityLabel={showRuntimeActivityRow ? activityStatusLabel : null}
                                                agentMotionState={agentMotionState}
                                                mentionableNodes={mentionableNodes}
                                                renderEmptyActivity={!showRuntimeComposerCompanion}
                                            />
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
                                            {showCloudActivityRow && (
                                                <AgentActivityRow
                                                    label={activityStatusLabel}
                                                    state={agentMotionState}
                                                    gazeTarget={null}
                                                />
                                            )}
                                        </>
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
                                        className="absolute bottom-[8.75rem] right-6 z-20 pointer-events-auto"
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

                            <div className="clash-copilot-composer-stack absolute bottom-0 left-0 right-0">
                                {slashCommandOptions.length > 0 && (
                                    <SlashCommandPalette
                                        commands={slashCommandOptions}
                                        onPick={handlePickSlashCommand}
                                    />
                                )}
                                {chatMode === 'runtime' && clashRt.promptQueueEnabled && visibleRuntimePromptQueue.length > 0 && (
                                    <RuntimePromptQueueBar
                                        items={visibleRuntimePromptQueue}
                                        onSteer={clashRt.steerQueuedPrompt}
                                        onEdit={(item) => {
                                            setEditingQueuedTurnId(item.turnId);
                                            setInput(item.text);
                                        }}
                                        onRemove={clashRt.removeQueuedPrompt}
                                        onReorder={clashRt.reorderPromptQueue}
                                    />
                                )}
                                <div className="relative z-20">
                                    {showRuntimeComposerCompanion && (
                                        <motion.div
                                            className="clash-copilot-agent-activity-empty-anchor clash-copilot-agent-activity-composer-companion mx-auto w-full max-w-[68rem] px-4 pb-1 sm:px-6"
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 6 }}
                                            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                        >
                                            <AgentActivitySlot
                                                label={showRuntimeActivityRow ? activityStatusLabel : null}
                                                state={showRuntimeActivityRow ? agentMotionState : 'idle'}
                                                gazeTarget={null}
                                                emptyLabel={t('copilot.status.readyWhenYouAre')}
                                            />
                                        </motion.div>
                                    )}
                                    <div
                                        aria-hidden="true"
                                        data-testid="composer-bottom-fade"
                                        className="clash-copilot-composer-bottom-fade"
                                    />
                                    <div className="relative z-10">
                                        <ChatInput
                                            input={input}
                                            onInputChange={setInput}
                                            onSubmit={handleSubmit}
                                            onStop={handleStop}
                                            isProcessing={isProcessing}
                                            isCreatingSession={isCreatingSession || (chatMode === 'cloud' && waitingFirstSend)}
                                            connected={chatMode === 'runtime' ? clashRt.ready : connected}
                                            error={chatMode === 'cloud' ? (sessionError || connectionError) : sessionError}
                                            onDismissError={() => { setSessionError(null); clearConnectionError(); }}
                                            allowSubmitWhileProcessing={chatMode === 'runtime'}
                                            disabled={chatMode === 'runtime' && !clashRt.ready && !(
                                                isDesktopLocalMode &&
                                                desktopLocalRuntime?.status === 'online' &&
                                                desktopLocalRuntime.agents.length > 0 &&
                                                (clashRt.status === 'draft' || clashRt.status === 'idle' || clashRt.status === 'disconnected')
                                            )}
                                            placeholder={selectedNodes.length > 0 ? 'Ask anything about selected files...' : 'Ask anything...'}
                                            mentionableNodes={mentionableNodes}
                                            projectId={projectId}
                                            toolbarAccessory={(
                                                <HarnessPermissionSelector
                                                    selectedPermissionModeId={sessionPermissionModeId}
                                                    sessionModes={effectiveSessionModes}
                                                    modeConfigOption={modeConfigOption}
                                                    onSelectPermissionMode={handleSelectSessionPermissionMode}
                                                />
                                            )}
                                            rightToolbarAccessory={(
                                                <SessionConfigSelector
                                                    open={sessionConfigOpen}
                                                    onOpenChange={setSessionConfigOpen}
                                                    embedded
                                                    selectedHarnessId={effectiveSessionHarnessId}
                                                    statusLabel={null}
                                                    harnessOptions={sessionHarnessOptions}
                                                    harnessLocked={sessionHarnessLocked}
                                                    modelConfigOption={modelConfigOption}
                                                    thoughtLevelConfigOption={thoughtLevelConfigOption}
                                                    onSelectHarness={handleSelectSessionHarness}
                                                    onSelectConfigOption={handleSelectSessionConfigOption}
                                                />
                                            )}
                                        />
                                    </div>
                                </div>
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
                onPick={async (agentMemberId, resumeId, agentId) => {
                    const rt = runtimePicker;
                    setRuntimePicker(null);
                    if (!rt) return;
                    setChatMode('runtime');
                    const pickedAgentId = agentId ?? preferredLocalAgentId(rt.agents);
                    const pickedAgent = pickedAgentId ? rt.agents.find((agent) => agent.id === pickedAgentId) : null;
                    if (pickedAgent?.auth?.status === 'needs-auth') {
                        setSessionHarnessId(pickedAgent.id);
                        setSessionError(null);
                        await clashRt.refresh({ probe: 'config', refresh: true });
                        return;
                    }
                    const pickedModeConfigOption = findAcpSelectConfigOption(pickedAgent?.config_options ?? [], 'mode');
                    const pickedPermissionModeId = pickedAgentId
                        ? resolvePermissionModeForSession(
                            sessionPermissionModeByAgentId[pickedAgentId],
                            pickedAgent?.session_modes ?? null,
                            pickedModeConfigOption,
                        )
                        : null;
                    await clashRt.select(rt.id, agentMemberId ?? undefined, {
                        projectId,
                        resumeAcpSessionId: resumeId,
                        agentId,
                        ...permissionModeOption(pickedPermissionModeId),
                    });
                }}
                onRecheckAgents={() => {
                    void clashRt.refresh({ probe: 'config', refresh: true });
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

function normalizeSlashCommandName(command: AvailableCommand): string {
    return command.name.replace(/^\/+/, '').trim();
}

function SlashCommandPalette({
    commands,
    onPick,
}: {
    commands: AvailableCommand[];
    onPick: (command: AvailableCommand) => void;
}) {
    return (
        <div
            role="listbox"
            aria-label="Slash commands"
            className="mx-5 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-warm-border bg-warm-surface/95 p-1.5 shadow-[0_18px_48px_rgba(23,19,13,0.12)] backdrop-blur"
        >
            {commands.map((command) => {
                const name = normalizeSlashCommandName(command);
                const description = command.description ?? command.input?.hint;
                return (
                <button
                    key={command.name}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(command)}
                    title={description ?? `/${name}`}
                    aria-label={description ? `/${name} ${description}` : `/${name}`}
                    className="grid w-full grid-cols-[minmax(8rem,auto)_1fr] items-baseline gap-4 rounded-xl px-3 py-2 text-left transition-colors hover:bg-warm-muted focus-visible:bg-warm-muted focus-visible:outline-none"
                >
                    <span className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">/{name}</span>
                    {description ? (
                        <span className="min-w-0 truncate text-sm text-stone-500 dark:text-stone-400">{description}</span>
                    ) : null}
                </button>
                );
            })}
        </div>
    );
}

function RuntimeAuthNotice({
    title,
    message,
    command,
    busy,
    onAuthenticate,
    onRecheck,
}: {
    title: string;
    message: string;
    command?: string;
    busy: boolean;
    onAuthenticate: () => void;
    onRecheck: () => void;
}) {
    return (
        <div
            role="alert"
            className="mx-auto flex w-full max-w-[68rem] items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"
        >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-300/10 dark:text-amber-200">
                <ShieldWarning className="h-4 w-4" weight="bold" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-5">{title}</span>
                {message ? (
                    <span className="mt-0.5 block leading-5 text-amber-900/80 dark:text-amber-100/80">{message}</span>
                ) : null}
                {command ? (
                    <details className="mt-1.5 text-xs text-amber-800/75 dark:text-amber-100/70">
                        <summary className="cursor-pointer select-none font-medium">Manual fallback</summary>
                        <span className="mt-1 block leading-5">
                            If Sign in does not open, run <code className="rounded bg-amber-100 px-1 font-mono dark:bg-amber-300/10">{command}</code> and use <code className="rounded bg-amber-100 px-1 font-mono dark:bg-amber-300/10">/auth</code>.
                        </span>
                    </details>
                ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
                <button
                    type="button"
                    onClick={onRecheck}
                    disabled={busy}
                    className="rounded-lg border border-amber-300/70 bg-transparent px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-300/30 dark:text-amber-100"
                >
                    Check again
                </button>
                <button
                    type="button"
                    onClick={onAuthenticate}
                    disabled={busy}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100"
                >
                    {busy ? "Opening..." : "Sign in"}
                </button>
            </span>
        </div>
    );
}

function SessionConfigSelector({
    open,
    onOpenChange,
    embedded = false,
    selectedHarnessId,
    statusLabel,
    harnessOptions,
    harnessLocked,
    modelConfigOption,
    thoughtLevelConfigOption,
    onSelectHarness,
    onSelectConfigOption,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    embedded?: boolean;
    selectedHarnessId: string | null;
    statusLabel?: string | null;
    harnessOptions: Runtime['agents'];
    harnessLocked?: boolean;
    modelConfigOption: AcpSessionConfigOption | null;
    thoughtLevelConfigOption: AcpSessionConfigOption | null;
    onSelectHarness: (agentId: string) => void;
    onSelectConfigOption: (configId: string, value: string | boolean) => void;
}) {
    const { t } = useTranslation();
    const selectedHarnessName = agentDisplayName(selectedHarnessId);
    const modelGroups = useMemo(
        () => modelValuesForHarness(modelConfigOption, selectedHarnessName),
        [modelConfigOption, selectedHarnessName],
    );
    const selectedModel = useMemo(() => selectedAcpSelectValue(modelConfigOption), [modelConfigOption]);
    const thoughtValues = useMemo(() => flattenAcpSelectValues(thoughtLevelConfigOption), [thoughtLevelConfigOption]);
    const selectedThoughtLevel = useMemo(() => selectedAcpSelectValue(thoughtLevelConfigOption), [thoughtLevelConfigOption]);
    const modelLabel = selectedModel?.name ?? agentDisplayName(selectedHarnessId);
    const triggerLabel = selectedModel
        ? `${selectedHarnessName} · ${modelLabel}`
        : selectedHarnessName;
    const modelOptionCount = useMemo(
        () => modelGroups.reduce((count, group) => count + group.options.length, 0),
        [modelGroups],
    );
    const hasModelSwitch = !!modelConfigOption && modelOptionCount > 0;
    const selectorDisabled = !!harnessLocked && !hasModelSwitch;
    const submenuMode = modelOptionCount > 8 ? 'drilldown' : 'flyout';
    const hasStatusLabel = !!statusLabel;
    const menuLabel = t('copilot.sessionConfig.label');
    const comboHarnesses = harnessOptions.length > 0
        ? harnessOptions
        : selectedHarnessId
            ? [{ id: selectedHarnessId }]
            : [];
    const modelSections = useMemo<SelectSection<string>[]>(() => {
        const sections: SelectSection<string>[] = [];
        const thoughtSubmenuSections: SelectSection<string>[] = thoughtLevelConfigOption && thoughtValues.length > 0
            ? [{
                id: 'thought-level-values',
                label: <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">Effort</span>,
                options: thoughtValues.map((value) => ({
                    value: JSON.stringify({ type: 'config', configId: thoughtLevelConfigOption.id, value: value.value }),
                    label: value.name,
                    description: value.description ?? undefined,
                    selected: value.value === thoughtLevelConfigOption.currentValue,
                })),
            }]
            : [];
        if (comboHarnesses.length > 0) {
            sections.push({
                id: 'harness',
                label: <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">Harness</span>,
                options: comboHarnesses.map((agent) => ({
                    value: JSON.stringify({ type: 'harness', agentId: agent.id }),
                    label: agent.label ?? agentDisplayName(agent.id),
                    description: harnessLocked
                        ? 'Locked for this session'
                        : agent.auth?.status === 'needs-auth'
                            ? 'Auth needed'
                            : undefined,
                    icon: <AcpAgentLogo agentId={agent.id} title={agent.label ?? agentDisplayName(agent.id)} className="h-4 w-4" />,
                    selected: agent.id === selectedHarnessId,
                    disabled: harnessLocked,
                })),
            });
        }
        if (modelConfigOption && modelGroups.length > 0) {
            sections.push({
                id: 'acp-model',
                label: (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">
                        {modelConfigOption.name || 'Model'}
                    </span>
                ),
                options: modelGroups.flatMap((group) => group.options).map((value) => {
                    const selected = value.value === modelConfigOption.currentValue;
                    return {
                        value: JSON.stringify({ type: 'config', configId: modelConfigOption.id, value: value.value }),
                        label: value.name,
                        selected,
                        ...(selected && thoughtSubmenuSections.length > 0
                            ? {
                                hasSubmenu: true,
                                submenuLabel: 'Effort',
                                submenuSections: thoughtSubmenuSections,
                            }
                            : {}),
                    };
                }),
            });
        }
        if (!modelConfigOption && thoughtLevelConfigOption && thoughtValues.length > 0) {
            sections.push({
                id: 'thought-level',
                options: [{
                    value: JSON.stringify({ type: 'noop', configId: thoughtLevelConfigOption.id }),
                    label: thoughtLevelConfigOption.name || 'Thinking effort',
                    description: selectedThoughtLevel?.name,
                    hasSubmenu: true,
                    submenuLabel: thoughtLevelConfigOption.name || 'Thinking effort',
                    submenuSections: [{
                        id: 'thought-level-values',
                        options: thoughtValues.map((value) => ({
                            value: JSON.stringify({ type: 'config', configId: thoughtLevelConfigOption.id, value: value.value }),
                            label: value.name,
                            description: value.description ?? undefined,
                            selected: value.value === thoughtLevelConfigOption.currentValue,
                        })),
                    }],
                }],
            });
        }
        return sections;
    }, [
        comboHarnesses,
        harnessLocked,
        modelConfigOption,
        modelGroups,
        selectedHarnessId,
        selectedThoughtLevel?.name,
        thoughtLevelConfigOption,
        thoughtValues,
    ]);

    return (
        <SelectMenu
            className={embedded ? 'relative flex justify-start' : 'relative flex justify-start px-4 pb-2'}
            triggerClassName="clash-session-config-trigger max-w-full text-left"
            open={open}
            onOpenChange={onOpenChange}
            value={modelConfigOption && selectedModel
                ? JSON.stringify({ type: 'config', configId: modelConfigOption.id, value: selectedModel.value })
                : JSON.stringify({ type: 'harness', agentId: selectedHarnessId ?? '' })}
            sections={modelSections}
            disabled={selectorDisabled}
            onValueChange={(value) => {
                try {
                    const parsed = JSON.parse(value) as { type?: string; configId?: string; value?: string; agentId?: string };
                    if (parsed.type === 'config' && parsed.configId && typeof parsed.value === 'string') {
                        onSelectConfigOption(parsed.configId, parsed.value);
                    } else if (parsed.type === 'harness' && parsed.agentId) {
                        onSelectHarness(parsed.agentId);
                    }
                } catch { /* ignore malformed menu value */ }
            }}
            ariaLabel={menuLabel}
            title={triggerLabel}
            variant="inline"
            placement="top"
            menuWidth={280}
            maxMenuHeight={420}
            submenuMode={submenuMode}
            submenuWidth={220}
            stopPropagation
            triggerPrefix={(
                <>
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700 dark:text-slate-200">
                    <AcpAgentLogo agentId={selectedHarnessId} title={agentDisplayName(selectedHarnessId)} className="h-4 w-4" />
                </span>
                <span
                    data-session-config-status-slot=""
                    aria-live="polite"
                    className={`clash-session-config-status-slot truncate text-[11px] font-medium text-stone-500 transition-[max-width,opacity] duration-150 dark:text-stone-400 ${
                        hasStatusLabel ? 'max-w-[4.25rem] opacity-100' : 'max-w-0 opacity-0'
                    }`}
                >
                    {statusLabel ?? ''}
                </span>
                </>
            )}
            triggerLabel={modelLabel}
        />
    );
}

function HarnessPermissionSelector({
    selectedPermissionModeId,
    sessionModes,
    modeConfigOption,
    onSelectPermissionMode,
}: {
    selectedPermissionModeId: string | null;
    sessionModes: AcpSessionModeState | null;
    modeConfigOption: AcpSessionConfigOption | null;
    onSelectPermissionMode: (modeId: string) => void;
}) {
    const modeValues = useMemo(() => flattenAcpSelectValues(modeConfigOption), [modeConfigOption]);
    const sessionModeValues = useMemo(
        () => sessionModes?.availableModes.filter((mode) => typeof mode.id === 'string' && typeof mode.name === 'string') ?? [],
        [sessionModes],
    );
    const selectedSessionMode = useMemo(() => (
        sessionModeValues.find((mode) => mode.id === selectedPermissionModeId) ??
        sessionModeValues.find((mode) => mode.id === sessionModes?.currentModeId) ??
        sessionModeValues[0] ??
        null
    ), [selectedPermissionModeId, sessionModeValues, sessionModes?.currentModeId]);
    const selectedAcpMode = useMemo(() => (
        modeValues.find((mode) => mode.value === selectedPermissionModeId) ??
        selectedAcpSelectValue(modeConfigOption)
    ), [modeConfigOption, modeValues, selectedPermissionModeId]);
    const selectedMode = useMemo(() => {
        if (selectedSessionMode) {
            return {
                value: selectedSessionMode.id,
                label: selectedSessionMode.name,
                description: selectedSessionMode.description ?? undefined,
            };
        }
        if (selectedAcpMode) {
            return {
                value: selectedAcpMode.value,
                label: selectedAcpMode.name,
                description: selectedAcpMode.description ?? undefined,
            };
        }
        return null;
    }, [selectedAcpMode, selectedSessionMode]);
    const sections = useMemo<SelectSection<string>[]>(() => [
        {
            id: 'modes',
            label: sessionModeValues.length > 0 ? 'Mode' : modeConfigOption?.name ?? 'Mode',
            options: sessionModeValues.length > 0
                ? sessionModeValues.map((mode) => ({
                    value: mode.id,
                    label: mode.name,
                    description: mode.description ?? undefined,
                    selected: mode.id === selectedMode?.value,
                    icon: <ShieldWarning className="h-4 w-4" aria-hidden="true" />,
                }))
                : modeValues.map((mode) => ({
                    value: mode.value,
                    label: mode.name,
                    description: mode.description ?? undefined,
                    selected: mode.value === selectedPermissionModeId,
                    icon: <ShieldWarning className="h-4 w-4" aria-hidden="true" />,
            })),
        },
    ], [modeConfigOption?.name, modeValues, selectedMode, selectedPermissionModeId, sessionModeValues]);

    if (!selectedMode) return null;
    return (
        <SelectMenu
            className="relative flex justify-start"
            triggerClassName="clash-session-config-trigger max-w-full text-left text-status-down"
            value={selectedMode.value}
            sections={sections}
            onValueChange={onSelectPermissionMode}
            ariaLabel="Harness permission mode"
            title={selectedMode.description ?? undefined}
            variant="inline"
            placement="top"
            menuWidth={220}
            maxMenuHeight={280}
            stopPropagation
            triggerPrefix={(
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-status-down">
                    <ShieldWarning className="h-4 w-4" aria-hidden="true" />
                </span>
            )}
            triggerLabel={selectedMode.label}
        />
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
    onSelect,
}: {
    label: string;
    sub?: string;
    active?: boolean;
    disabled?: boolean;
    onSelect: () => void;
}) {
    return (
        <DropdownMenuItem
            aria-current={active ? 'true' : undefined}
            disabled={disabled}
            onSelect={onSelect}
            className={`min-h-[44px] ${active ? 'bg-warm-muted/80 dark:bg-slate-800' : ''}`}
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
        </DropdownMenuItem>
    );
}

const RuntimeMessageRow = memo(function RuntimeMessageRow({
    message,
    mentionableNodes,
}: {
    message: RuntimeMessage;
    mentionableNodes: MentionNodeRef[];
}) {
    const userContent = message.role === 'user'
        ? message.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : '';

    return (
        <motion.div
            className={message.role === 'user'
                ? 'flex justify-end'
                : 'w-full max-w-[min(68rem,100%)]'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 180px' }}
        >
            {message.role === 'user' ? (
                <UserMessage
                    content={userContent}
                    mentionNodes={mentionableNodes}
                />
            ) : (
                <AcpMessageList messages={[message]} />
            )}
        </motion.div>
    );
});

/**
 * Stripped-down message list for local runtime mode. The cloud render path is heavy
 * (tool cards, agent personas, thinking process, mentions, …) and assumes
 * UIMessage shape from useAgentChat. Runtime messages are already normalized
 * to parts.
 */
function RuntimeMessageList({
    messages,
    ready,
    desktopLocalMode,
    localRuntime,
    setupIssue,
    status,
    activityLabel,
    agentMotionState,
    mentionableNodes,
    renderEmptyActivity = true,
}: {
    messages: RuntimeMessage[];
    ready: boolean;
    desktopLocalMode?: boolean;
    localRuntime?: Runtime | null;
    setupIssue?: string | null;
    status: ClashRuntimeStatus;
    activityLabel?: string | null;
    agentMotionState: AgentMotionState;
    mentionableNodes: MentionNodeRef[];
    renderEmptyActivity?: boolean;
}) {
    const { t } = useTranslation();
    if (messages.length === 0) {
        const hasLocalAgent = !!localRuntime && localRuntime.status === 'online' && localRuntime.agents.length > 0;
        const activitySlot = (
            <motion.div
                className="clash-copilot-agent-activity-empty-anchor clash-copilot-agent-activity-composer-companion mx-auto flex min-h-[calc(100dvh-6.5rem)] w-full max-w-[68rem] flex-col justify-end gap-3 pb-0"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
                <AgentActivitySlot
                    label={activityLabel ?? null}
                    state={activityLabel ? agentMotionState : 'idle'}
                    gazeTarget={null}
                    emptyLabel={t('copilot.status.readyWhenYouAre')}
                />
            </motion.div>
        );
        if (activityLabel && renderEmptyActivity) {
            return activitySlot;
        }
        if (setupIssue) return null;
        if (desktopLocalMode && !setupIssue && !ready && (status === 'idle' || status === 'connecting') && (!localRuntime || hasLocalAgent)) {
            return <RuntimeLoadingStatus label={t('copilot.status.desktopLocalStarting')} />;
        }
        if (!renderEmptyActivity) {
            return null;
        }
        if (desktopLocalMode && status === 'draft' && renderEmptyActivity) {
            return activitySlot;
        }
        if (desktopLocalMode && ready && renderEmptyActivity) {
            return activitySlot;
        }
        const emptyText = setupIssue
            ? t('copilot.status.desktopLocalSetupRequired')
            : ready
            ? t('copilot.status.localAgentReady')
            : desktopLocalMode
                ? t(hasLocalAgent ? 'copilot.status.desktopLocalStarting' : 'copilot.status.desktopLocalRequired')
                : t('copilot.status.localRuntimeRequired');
        return (
            <div className="text-center text-sm text-stone-600 py-12 dark:text-stone-300">
                {emptyText}
            </div>
        );
    }
    return (
        <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-3">
            {messages.map((message) => (
                <RuntimeMessageRow
                    key={message.id}
                    message={message}
                    mentionableNodes={mentionableNodes}
                />
            ))}
            {activityLabel ? (
                <div key="runtime-agent-activity-slot-wrapper" className="clash-copilot-agent-activity-wrapper">
                    <AgentActivitySlot
                        label={activityLabel}
                        state={agentMotionState}
                        gazeTarget={null}
                    />
                </div>
            ) : null}
        </div>
    );
}

function RuntimePromptQueueBar({
    items,
    onSteer,
    onEdit,
    onRemove,
    onReorder,
}: {
    items: RuntimeQueuedPrompt[];
    onSteer: (turnId: string) => void;
    onEdit: (item: RuntimeQueuedPrompt) => void;
    onRemove: (turnId: string) => void;
    onReorder: (turnIds: string[]) => void;
}) {
    const [openMenuTurnId, setOpenMenuTurnId] = useState<string | null>(null);
    const [draggingTurnId, setDraggingTurnId] = useState<string | null>(null);
    const [dragOverTurnId, setDragOverTurnId] = useState<string | null>(null);
    const reorder = (fromTurnId: string, toTurnId: string) => {
        if (fromTurnId === toTurnId) return;
        const fromIndex = items.findIndex((item) => item.turnId === fromTurnId);
        const toIndex = items.findIndex((item) => item.turnId === toTurnId);
        if (fromIndex < 0 || toIndex < 0) return;
        const next = [...items];
        const [moved] = next.splice(fromIndex, 1);
        if (!moved) return;
        next.splice(toIndex, 0, moved);
        onReorder(next.map((item) => item.turnId));
    };

    return (
        <div className="clash-runtime-prompt-queue relative z-0 mx-auto -mb-10 w-[calc(100%-6rem)] max-w-[940px] overflow-visible rounded-t-[20px] px-3 pb-[3.25rem] pt-2.5 text-xs">
            <div className="flex flex-col gap-1">
                {items.map((item, index) => {
                    return (
                        <div
                            key={item.turnId}
                            draggable
                            onDragStart={(event) => {
                                setDraggingTurnId(item.turnId);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', item.turnId);
                            }}
                            onDragEnter={() => setDragOverTurnId(item.turnId)}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                setDragOverTurnId(item.turnId);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const fromTurnId = event.dataTransfer.getData('text/plain') || draggingTurnId;
                                if (fromTurnId) reorder(fromTurnId, item.turnId);
                                setDraggingTurnId(null);
                                setDragOverTurnId(null);
                            }}
                            onDragEnd={() => {
                                setDraggingTurnId(null);
                                setDragOverTurnId(null);
                            }}
                            className={`relative flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors ${
                                dragOverTurnId === item.turnId && draggingTurnId !== item.turnId
                                    ? 'bg-warm-muted/70 dark:bg-stone-900'
                                    : ''
                            } ${draggingTurnId === item.turnId ? 'opacity-55' : ''}`}
                        >
                            <span className="flex h-5 w-5 shrink-0 cursor-grab items-center justify-center text-stone-500 opacity-100 transition-colors hover:text-stone-600 active:cursor-grabbing dark:text-stone-400 dark:hover:text-stone-300" aria-hidden="true">
                                <DotsSixVertical className="h-4 w-4" weight="bold" />
                            </span>
                            <ArrowBendDownRight className="h-3.5 w-3.5 shrink-0 text-stone-500/70 dark:text-stone-400/70" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-stone-700 dark:text-stone-200">
                                {item.text}
                            </span>
                            <button
                                type="button"
                                aria-label={`Steer queued message ${index + 1}`}
                                onClick={() => onSteer(item.turnId)}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[13px] font-medium text-stone-500 opacity-70 transition hover:bg-warm-muted/70 hover:text-slate-900 hover:opacity-100 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-slate-50"
                            >
                                <ArrowBendDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                                Steer
                            </button>
                            <button
                                type="button"
                                aria-label={`Remove queued message ${index + 1}`}
                                onClick={() => onRemove(item.turnId)}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-stone-500 opacity-70 transition hover:bg-red-50 hover:text-red-600 hover:opacity-100 dark:text-stone-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            >
                                <Trash className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <div className="relative shrink-0">
                                <button
                                    type="button"
                                    aria-label={`Queued message options ${index + 1}`}
                                    onClick={() => setOpenMenuTurnId((current) => current === item.turnId ? null : item.turnId)}
                                    className="flex h-5 w-5 items-center justify-center rounded-full text-stone-500 opacity-70 transition hover:bg-warm-muted hover:text-slate-800 hover:opacity-100 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-slate-100"
                                >
                                    <DotsThree className="h-4 w-4" weight="bold" aria-hidden="true" />
                                </button>
                                <AnimatePresence>
                                    {openMenuTurnId === item.turnId && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                                            className="absolute right-0 top-8 z-40 w-52 rounded-2xl border border-warm-border bg-warm-surface p-1.5 text-sm shadow-xl dark:border-stone-800 dark:bg-stone-950"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onEdit(item);
                                                    setOpenMenuTurnId(null);
                                                }}
                                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-medium text-slate-800 transition-colors hover:bg-warm-muted dark:text-slate-100 dark:hover:bg-stone-900"
                                            >
                                                <PencilSimple className="h-4 w-4 text-stone-500" aria-hidden="true" />
                                                Edit message
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onRemove(item.turnId);
                                                    setOpenMenuTurnId(null);
                                                }}
                                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                            >
                                                <Trash className="h-4 w-4" aria-hidden="true" />
                                                Delete
                                            </button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AgentActivityRow({
    label,
    state,
    gazeTarget,
}: {
    label: string;
    state: AgentMotionState;
    gazeTarget?: { x: number; y: number } | null;
}) {
    return (
        <div
            data-activity-layout="stable"
            className="clash-copilot-agent-activity-row flex items-center gap-0.5 px-0 py-0.5"
        >
            <span className="inline-flex">
                <CopilotRailSlot className="h-8">
                    <AgentMotion
                        state={state}
                        className="h-6 w-6"
                        gazeTarget={gazeTarget ?? null}
                    />
                </CopilotRailSlot>
            </span>
            <span data-agent-activity-label className="inline-flex min-w-0 -ml-0.5">
                <AgentStatusLine label={label} />
            </span>
        </div>
    );
}

function AgentActivitySlot({
    label,
    state,
    gazeTarget,
    emptyLabel,
}: {
    label: string | null;
    state: AgentMotionState;
    gazeTarget?: { x: number; y: number } | null;
    emptyLabel?: string | null;
}) {
    const visibleLabel = label ?? emptyLabel ?? null;
    return (
        <div className="clash-copilot-agent-activity-slot min-h-9">
            {visibleLabel ? (
                <AgentActivityRow
                    label={visibleLabel}
                    state={state}
                    gazeTarget={gazeTarget ?? null}
                />
            ) : null}
        </div>
    );
}

function AgentStatusLine({ label }: { label: string }) {
    return (
        <motion.div
            role="status"
            aria-label={label}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex min-h-[24px] items-center overflow-hidden rounded-full px-0.5 text-xs font-semibold text-stone-600 dark:text-stone-300"
        >
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={label}
                    initial={{ opacity: 0, y: 8, filter: 'blur(2px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -8, filter: 'blur(2px)' }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                >
                    {label}
                </motion.span>
            </AnimatePresence>
        </motion.div>
    );
}

function RuntimeLoadingStatus({ label }: { label: string }) {
    return (
        <div role="status" aria-label={label} aria-live="polite" className="sr-only" />
    );
}
