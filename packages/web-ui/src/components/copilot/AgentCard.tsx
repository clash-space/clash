import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, CheckCircle, CircleNotch, PauseCircle, Robot, Crown, FilmStrip, Scroll, MagicWand, VideoCamera } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDisclosure } from '@clash/web-ui/lib/hooks/useDisclosure';

import { ToolCall, ToolCallProps } from './ToolCall';
import { ThinkingProcess } from './ThinkingProcess';
import ReactMarkdown from 'react-markdown';

export interface AgentLog {
    id: string;
    type: 'text' | 'tool_call' | 'thinking';
    content?: React.ReactNode;
    toolProps?: ToolCallProps;
    taskName?: string;
}

interface AgentCardProps {
    agentName: string;
    status: 'working' | 'done' | 'waiting' | 'failed';
    children?: React.ReactNode;
    isExpanded?: boolean;
    persona?: 'director' | 'scriptwriter' | 'videoproducer' | 'conceptartist' | 'storyboardartist' | 'default';
    logs?: AgentLog[];
}

export function AgentCard({ agentName, status, children, isExpanded: initialExpanded = true, persona = 'default', logs = [] }: AgentCardProps) {
    const { t } = useTranslation();
    const { isOpen, triggerProps, panelProps } = useDisclosure(initialExpanded);

    // Pill colors meet WCAG AA against the surface in both themes.
    const statusConfig = {
        working: { icon: CircleNotch, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-100 dark:bg-blue-950/50', animate: true },
        done: { icon: CheckCircle, color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-950/50', animate: false },
        waiting: { icon: PauseCircle, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950/50', animate: false },
        failed: { icon: Robot, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', animate: false },
    };

    // Personas differ by icon shape only — no per-role color theme.
    // Differentiation through iconography keeps the panel calm; semantic
    // color is reserved for status (working/done/failed).
    const personaIcons: Record<NonNullable<AgentCardProps['persona']>, typeof Robot> = {
        director: Crown,
        scriptwriter: Scroll,
        videoproducer: VideoCamera,
        conceptartist: MagicWand,
        storyboardartist: FilmStrip,
        default: Robot,
    };

    const config = statusConfig[status] ?? statusConfig.waiting;
    const displayStatus = statusConfig[status] ? status : 'waiting';
    const PersonaIcon = personaIcons[persona] ?? personaIcons.default;
    const StatusIcon = config.icon;
    const statusLabel = t(`copilot.agentCard.status.${displayStatus}` as const);

    return (
        <div className="w-full rounded-xl bg-warm-surface shadow-sm border border-warm-border overflow-hidden my-2">
            <button
                {...triggerProps}
                className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-warm-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand text-left"
            >
                <span className="flex items-center gap-3">
                    <span className="p-2 rounded-xl bg-warm-muted relative flex items-center justify-center" aria-hidden="true">
                        <PersonaIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" weight="duotone" />
                        {config.animate && (
                            <span className="absolute -bottom-1 -right-1 bg-warm-surface rounded-full p-0.5 shadow-sm">
                                <StatusIcon className="w-3 h-3 text-blue-700 dark:text-blue-300 animate-spin motion-reduce:animate-none" weight="bold" />
                            </span>
                        )}
                    </span>
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                        {agentName}
                    </span>
                </span>

                <span className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.color} font-medium`}>
                        {statusLabel}
                    </span>
                    {isOpen ? (
                        <CaretDown className="w-4 h-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
                    ) : (
                        <CaretRight className="w-4 h-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
                    )}
                </span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        {...panelProps}
                        aria-label={`${agentName} — ${statusLabel}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="px-4 pb-4 pt-0 border-t border-warm-border">
                            <div className="pt-3 space-y-2">
                                {logs && logs.map(log => (
                                    <div key={log.id} className="mb-2 last:mb-0">

                                        {log.type === 'text' && (
                                            typeof log.content === 'string' ? (
                                                <div className="text-sm text-slate-700 prose prose-sm max-w-none dark:text-slate-300 dark:prose-invert">
                                                    <ReactMarkdown>{log.content}</ReactMarkdown>
                                                </div>
                                            ) : log.content
                                        )}
                                        {log.type === 'thinking' && typeof log.content === 'string' && (
                                            <ThinkingProcess content={log.content} />
                                        )}
                                        {log.type === 'tool_call' && log.toolProps && (
                                            <ToolCall {...log.toolProps} />
                                        )}
                                    </div>

                                ))}
                                {children}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}
