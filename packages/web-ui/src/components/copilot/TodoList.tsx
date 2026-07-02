import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CaretDown, CaretUp, ListChecks } from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Button } from '../ui/button';

export interface TodoItem {
    id: string;
    text: string;
    status: 'pending' | 'in-progress' | 'completed';
}

interface TodoListProps {
    items: TodoItem[];
    title?: string;
}

export const TodoList: React.FC<TodoListProps> = ({ items, title = "Plan" }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (items.length === 0) return null;

    const completedCount = items.filter(i => i.status === 'completed').length;
    const totalCount = items.length;

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute left-6 bottom-[88px] z-10"
        >
            <Collapsible
                open={isExpanded}
                onOpenChange={setIsExpanded}
                className="bg-warm-surface border border-warm-border shadow-sm rounded-2xl overflow-hidden transition-shadow hover:shadow-md w-64"
            >
                <CollapsibleTrigger asChild>
                    <Button
                        className="min-h-0 w-full cursor-pointer justify-between rounded-none border-transparent bg-warm-muted px-3 py-2 text-left shadow-none hover:bg-warm-muted/80 focus-visible:ring-inset"
                    >
                        <span className="flex items-center gap-2">
                            <ListChecks className="w-4 h-4 text-stone-700 dark:text-stone-300" aria-hidden="true" />
                            <span className="text-xs font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">{title}</span>
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="text-xs text-stone-700 dark:text-stone-300 font-medium">{completedCount}/{totalCount}</span>
                            {isExpanded ? (
                                <CaretDown className="w-3 h-3 text-stone-700 dark:text-stone-300" aria-hidden="true" />
                            ) : (
                                <CaretUp className="w-3 h-3 text-stone-700 dark:text-stone-300" aria-hidden="true" />
                            )}
                        </span>
                    </Button>
                </CollapsibleTrigger>

                <AnimatePresence>
                    {isExpanded && (
                        <CollapsibleContent asChild forceMount>
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="border-t border-warm-border"
                            >
                                <div className="p-2 max-h-64 overflow-y-auto bg-warm-surface">
                                    {items.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-start gap-2 p-1.5 rounded-lg hover:bg-warm-muted transition-colors"
                                        >
                                            <div className="mt-0.5 shrink-0">
                                                {item.status === 'completed' ? (
                                                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center">
                                                        <Check className="w-2 h-2 text-white" weight="bold" />
                                                    </div>
                                                ) : (
                                                    <div className="w-3.5 h-3.5 rounded-full border border-warm-border bg-warm-surface" />
                                                )}
                                            </div>
                                            <span className={`text-sm leading-tight ${item.status === 'completed' ? 'text-stone-600 dark:text-stone-300 line-through' : 'text-stone-800 dark:text-stone-200'
                                                }`}>
                                                {item.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        </CollapsibleContent>
                    )}
                </AnimatePresence>
            </Collapsible>
        </motion.div>
    );
};
