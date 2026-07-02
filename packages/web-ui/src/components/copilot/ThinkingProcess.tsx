
import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, Sparkle } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Button } from '../ui/button';

interface ThinkingProcessProps {
    content: string;
    isExpanded?: boolean;
}

export function ThinkingProcess({ content, isExpanded: initialExpanded = false }: ThinkingProcessProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(initialExpanded);

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full my-2">
            <CollapsibleTrigger asChild>
                <Button
                    size="sm"
                    className="group -mx-1 min-h-0 w-fit cursor-pointer gap-2 rounded-md border-transparent bg-transparent px-1 py-0.5 shadow-none hover:bg-transparent"
                >
                    <span className="p-1 rounded-full bg-brand-light text-brand group-hover:bg-brand-light/75 transition-colors dark:bg-brand/15 dark:text-brand" aria-hidden="true">
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
                </Button>
            </CollapsibleTrigger>

            <AnimatePresence>
                {isOpen && (
                    <CollapsibleContent asChild forceMount>
                        <motion.div
                            aria-label={t('copilot.thinking.label')}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <div className="pl-2 ml-2.5 border-l-2 border-brand/20 py-2 mt-1 dark:border-brand/30">
                                <div className="text-sm text-slate-600 leading-relaxed font-mono bg-warm-muted/60 p-3 rounded-xl border border-warm-border prose prose-sm max-w-none dark:text-slate-300 dark:bg-warm-muted dark:prose-invert">
                                    <ReactMarkdown>{content}</ReactMarkdown>
                                </div>
                            </div>
                        </motion.div>
                    </CollapsibleContent>
                )}
            </AnimatePresence>
        </Collapsible>
    );
}
