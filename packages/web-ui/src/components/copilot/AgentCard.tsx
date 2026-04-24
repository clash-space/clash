
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, CheckCircle, CircleNotch, PauseCircle, Robot, Crown, FilmStrip, Scroll, MagicWand, VideoCamera } from '@phosphor-icons/react';

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
    const [isExpanded, setIsExpanded] = useState(initialExpanded);

    const statusConfig = {
        working: { icon: CircleNotch, color: 'text-blue-500', bg: 'bg-blue-50', animate: true },
        done: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', animate: false },
        waiting: { icon: PauseCircle, color: 'text-amber-500', bg: 'bg-amber-50', animate: false },
        failed: { icon: Robot, color: 'text-red-500', bg: 'bg-red-50', animate: false },
    };

    const personaConfig = {
        director: {
            icon: Crown,
            color: 'text-slate-700',
            bg: 'bg-slate-100',
            isPremium: true,
            ring: 'ring-1 ring-slate-200'
        },
        scriptwriter: { icon: Scroll, color: 'text-slate-600', bg: 'bg-slate-50', ring: 'ring-1 ring-slate-200' },
        videoproducer: { icon: VideoCamera, color: 'text-slate-600', bg: 'bg-slate-50', ring: 'ring-1 ring-slate-200' },
        conceptartist: { icon: MagicWand, color: 'text-purple-600', bg: 'bg-purple-50', ring: 'ring-1 ring-purple-200' },
        storyboardartist: { icon: FilmStrip, color: 'text-indigo-600', bg: 'bg-indigo-50', ring: 'ring-1 ring-indigo-200' },
        default: { icon: Robot, color: 'text-slate-600', bg: 'bg-slate-50', ring: 'ring-1 ring-slate-200' },
    };

    const config = statusConfig[status] ?? statusConfig.waiting;
    const displayStatus = statusConfig[status] ? status : 'waiting';
    const pConfig = personaConfig[persona] || personaConfig.default;
    const StatusIcon = config.icon;
    const PersonaIcon = pConfig.icon;
    const isPremium = (pConfig as any).isPremium;

    return (
        <div className={`w-full rounded-xl bg-white shadow-sm overflow-hidden my-2 transition-all ${isPremium ? 'border border-slate-200 shadow-md' : 'border border-slate-200'}`}>
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${pConfig.bg} ${(pConfig as any).ring || ''} relative flex items-center justify-center`}>
                        <PersonaIcon
                            className={`w-4 h-4 ${pConfig.color}`}
                            weight="duotone"
                        />
                        {config.animate && (
                            <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                                <StatusIcon className="w-3 h-3 text-blue-500 animate-spin" weight="bold" />
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className={`font-semibold text-sm ${isPremium ? 'text-slate-800' : 'text-slate-700'}`}>
                            {agentName}
                        </span>
                        {isPremium && <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider leading-none">Orchestrator</span>}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.color} font-medium capitalize`}>
                        {displayStatus}
                    </span>
                    {isExpanded ? (
                        <CaretDown className="w-4 h-4 text-slate-400" />
                    ) : (
                        <CaretRight className="w-4 h-4 text-slate-400" />
                    )}
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="px-4 pb-4 pt-0 border-t border-slate-100">
                            <div className="pt-3 space-y-2">
                                {logs && logs.map(log => (
                                    <div key={log.id} className="mb-2 last:mb-0">

                                        {log.type === 'text' && (
                                            typeof log.content === 'string' ? (
                                                <div className="text-sm text-slate-600 prose prose-sm max-w-none">
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
