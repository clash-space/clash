
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Check, X, CaretDown, CaretRight, CircleNotch } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDisclosure } from '@clash/web-ui/lib/hooks/useDisclosure';

export interface ToolCallProps {
    toolName: string;
    args: any;
    result?: any;
    status: 'pending' | 'success' | 'error' | 'failed';
    isExpanded?: boolean;
    indent?: boolean;
}

export function ToolCall({ toolName, args, result, status, isExpanded: initialExpanded = false, indent = false }: ToolCallProps) {
    const { t } = useTranslation();
    const { isOpen, triggerProps, panelProps } = useDisclosure(initialExpanded);

    const statusConfig = {
        pending: { icon: CircleNotch, color: 'text-brand', animate: true, label: 'pending' },
        success: { icon: Check, color: 'text-green-600 dark:text-green-400', animate: false, label: 'success' },
        error: { icon: X, color: 'text-red-600 dark:text-red-400', animate: false, label: 'error' },
        failed: { icon: X, color: 'text-red-600 dark:text-red-400', animate: false, label: 'failed' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
    const StatusIcon = config.icon;

    return (
        <div className={`w-full rounded-xl border border-warm-border bg-warm-muted/60 overflow-hidden text-sm dark:bg-warm-muted ${indent ? 'ml-6 w-[calc(100%-1.5rem)]' : ''}`}>
            <button
                {...triggerProps}
                aria-label={isOpen
                    ? `${t('copilot.toolCall.collapse')}: ${toolName} (${config.label})`
                    : `${t('copilot.toolCall.expand')}: ${toolName} (${config.label})`}
                className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-warm-hover transition-colors dark:hover:bg-warm-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
                <span className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" weight="fill" aria-hidden="true" />
                    <span className="font-medium text-slate-700 font-mono text-xs dark:text-slate-200">{toolName}</span>
                </span>

                <span className="flex items-center gap-2">
                    <StatusIcon
                        className={`w-3.5 h-3.5 ${config.color} ${config.animate ? 'animate-spin motion-reduce:animate-none' : ''}`}
                        weight="bold"
                        aria-hidden="true"
                    />
                    {isOpen ? (
                        <CaretDown className="w-3 h-3 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                    ) : (
                        <CaretRight className="w-3 h-3 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                    )}
                </span>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        {...panelProps}
                        aria-label={`${toolName} details`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="px-3 pb-3 pt-0 border-t border-warm-border">
                            <div className="pt-2 space-y-2">
                                <div>
                                    <div className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-1 dark:text-slate-400">{t('copilot.toolCall.input')}</div>
                                    <pre className="bg-warm-surface p-2 rounded border border-warm-border overflow-x-auto text-xs text-slate-700 font-mono dark:bg-warm-page dark:text-slate-300">
                                        {JSON.stringify(args, null, 2)}
                                    </pre>
                                </div>
                                {result && (
                                    <div>
                                        <div className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-1 dark:text-slate-400">{t('copilot.toolCall.output')}</div>
                                        <pre className="bg-warm-surface p-2 rounded border border-warm-border overflow-x-auto text-xs text-slate-700 font-mono dark:bg-warm-page dark:text-slate-300">
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
