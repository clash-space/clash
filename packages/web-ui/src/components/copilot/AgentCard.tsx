import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, CheckCircle, CircleNotch, PauseCircle, Robot, Crown, FilmStrip, Scroll, MagicWand, VideoCamera } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolCall, ToolCallProps } from './ToolCall';
import { ThinkingProcess } from './ThinkingProcess';
import ReactMarkdown from 'react-markdown';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Button } from '../ui/button';

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
    persona?: 'masterClash' | 'scriptwriter' | 'videoproducer' | 'conceptartist' | 'storyboardartist' | 'default';
    logs?: AgentLog[];
}

export function AgentCard({ agentName, status, children, isExpanded: initialExpanded = true, persona = 'default', logs = [] }: AgentCardProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(initialExpanded);

    // Working is the agent "alive" state, so it uses brand coral. Other
    // states stay semantic and subdued so the panel does not turn into a
    // status rainbow.
    const statusConfig = {
        working: { icon: CircleNotch, color: 'text-white', bg: 'bg-brand shadow-sm shadow-brand/20', animate: true },
        done: { icon: CheckCircle, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/50', animate: false },
        waiting: { icon: PauseCircle, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950/50', animate: false },
        failed: { icon: Robot, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950/50', animate: false },
    };

    // Personas differ by icon shape only — no per-role color theme.
    // Differentiation through iconography keeps the panel calm; semantic
    // color is reserved for status (working/done/failed).
    const personaIcons: Record<NonNullable<AgentCardProps['persona']>, typeof Robot> = {
        masterClash: Crown,
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
        <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="w-full rounded-xl bg-warm-surface shadow-sm border border-warm-border overflow-hidden my-2"
        >
            <CollapsibleTrigger asChild>
                <Button
                    className="min-h-0 w-full cursor-pointer justify-between rounded-none border-transparent bg-transparent px-4 py-3 text-left shadow-none hover:bg-warm-muted focus-visible:ring-inset"
                >
                    <span className="flex items-center gap-3">
                        <span className="p-2 rounded-xl bg-warm-muted relative flex items-center justify-center" aria-hidden="true">
                            <PersonaIcon className="w-4 h-4 text-slate-700 dark:text-slate-300" weight="duotone" />
                            {config.animate && (
                                <span className="absolute -bottom-1 -right-1 bg-warm-surface rounded-full p-0.5 shadow-sm">
                                    <StatusIcon className="w-3 h-3 text-brand animate-spin motion-reduce:animate-none" weight="bold" />
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
                </Button>
            </CollapsibleTrigger>

            <AnimatePresence>
                {isOpen && (
                    <CollapsibleContent asChild forceMount>
                        <motion.div
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
                    </CollapsibleContent>
                )}
            </AnimatePresence>
        </Collapsible>
    );
}
