import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CaretDown, CaretUp, ListChecks } from '@phosphor-icons/react';

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
            <div
                className="bg-white border border-gray-200 shadow-sm rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-md w-64"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="px-3 py-2 flex items-center justify-between bg-gray-50">
                    <div className="flex items-center gap-2">
                        <ListChecks className="w-4 h-4 text-gray-500" />
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 font-medium">{completedCount}/{totalCount}</span>
                        {isExpanded ? (
                            <CaretDown className="w-3 h-3 text-gray-400" />
                        ) : (
                            <CaretUp className="w-3 h-3 text-gray-400" />
                        )}
                    </div>
                </div>

                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="border-t border-gray-100"
                        >
                            <div className="p-2 max-h-64 overflow-y-auto bg-white">
                                {items.map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 transition-colors"
                                    >
                                        <div className="mt-0.5 shrink-0">
                                            {item.status === 'completed' ? (
                                                <div className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center">
                                                    <Check className="w-2 h-2 text-white" weight="bold" />
                                                </div>
                                            ) : (
                                                <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />
                                            )}
                                        </div>
                                        <span className={`text-sm leading-tight ${item.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700'
                                            }`}>
                                            {item.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};
