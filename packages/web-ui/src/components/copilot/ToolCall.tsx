
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Check, X, CaretDown, CaretRight, CircleNotch } from '@phosphor-icons/react';

export interface ToolCallProps {
    toolName: string;
    args: any;
    result?: any;
    status: 'pending' | 'success' | 'error' | 'failed';
    isExpanded?: boolean;
    indent?: boolean;
}

export function ToolCall({ toolName, args, result, status, isExpanded: initialExpanded = false, indent = false }: ToolCallProps) {
    const [isExpanded, setIsExpanded] = useState(initialExpanded);

    const statusConfig = {
        pending: { icon: CircleNotch, color: 'text-blue-500', animate: true },
        success: { icon: Check, color: 'text-green-500', animate: false },
        error: { icon: X, color: 'text-red-500', animate: false },
        failed: { icon: X, color: 'text-red-500', animate: false },
    };

    const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
    const StatusIcon = config.icon;

    return (
        <div className={`w-full rounded-xl border border-slate-100 bg-slate-50/50 overflow-hidden text-sm ${indent ? 'ml-6 w-[calc(100%-1.5rem)]' : ''}`}>
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-slate-500" weight="fill" />
                    <span className="font-medium text-slate-700 font-mono text-xs">{toolName}</span>
                </div>

                <div className="flex items-center gap-2">
                    <StatusIcon
                        className={`w-3.5 h-3.5 ${config.color} ${config.animate ? 'animate-spin' : ''}`}
                        weight="bold"
                    />
                    {isExpanded ? (
                        <CaretDown className="w-3 h-3 text-slate-400" />
                    ) : (
                        <CaretRight className="w-3 h-3 text-slate-400" />
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
                        <div className="px-3 pb-3 pt-0 border-t border-slate-100">
                            <div className="pt-2 space-y-2">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Input</div>
                                    <pre className="bg-white p-2 rounded border border-slate-200 overflow-x-auto text-xs text-slate-600 font-mono">
                                        {JSON.stringify(args, null, 2)}
                                    </pre>
                                </div>
                                {result && (
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Output</div>
                                        <pre className="bg-white p-2 rounded border border-slate-200 overflow-x-auto text-xs text-slate-600 font-mono">
                                            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
