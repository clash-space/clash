
import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, Sparkle } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { useDisclosure } from '@clash/web-ui/lib/hooks/useDisclosure';

interface ThinkingProcessProps {
    content: string;
    isExpanded?: boolean;
}

export function ThinkingProcess({ content, isExpanded: initialExpanded = false }: ThinkingProcessProps) {
    const { t } = useTranslation();
    const { isOpen, triggerProps, panelProps } = useDisclosure(initialExpanded);

    return (
        <div className="w-full my-2">
            <button
                {...triggerProps}
                className="flex items-center gap-2 cursor-pointer group w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface px-1 py-0.5 -mx-1"
            >
                <span className="p-1 rounded-full bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100 transition-colors dark:bg-indigo-950/50 dark:text-indigo-300 dark:group-hover:bg-indigo-900/50" aria-hidden="true">
                    <Sparkle className="w-3.5 h-3.5" weight="fill" />
                </span>
                <span className="text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors dark:text-slate-300 dark:group-hover:text-slate-100">
                    {t('copilot.thinking.label')}
                </span>
                {isOpen ? (
                    <CaretDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                ) : (
                    <CaretRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        {...panelProps}
                        aria-label={t('copilot.thinking.label')}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="pl-2 ml-2.5 border-l-2 border-slate-100 py-2 mt-1 dark:border-warm-border">
                            <div className="text-sm text-slate-600 leading-relaxed font-mono bg-slate-50/50 p-3 rounded-xl border border-slate-100 prose prose-sm max-w-none dark:text-slate-300 dark:bg-warm-muted dark:border-warm-border dark:prose-invert">
                                <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
