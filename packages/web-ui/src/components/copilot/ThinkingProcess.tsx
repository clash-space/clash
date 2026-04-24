
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretDown, CaretRight, Sparkle } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';

interface ThinkingProcessProps {
    content: string;
    isExpanded?: boolean;
}

export function ThinkingProcess({ content, isExpanded: initialExpanded = false }: ThinkingProcessProps) {
    const [isExpanded, setIsExpanded] = useState(initialExpanded);

    return (
        <div className="w-full my-2">
            <div
                className="flex items-center gap-2 cursor-pointer group w-fit"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="p-1 rounded-full bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100 transition-colors">
                    <Sparkle className="w-3.5 h-3.5" weight="fill" />
                </div>
                <span className="text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors">
                    Thinking Process
                </span>
                {isExpanded ? (
                    <CaretDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                    <CaretRight className="w-3.5 h-3.5 text-slate-400" />
                )}
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="pl-2 ml-2.5 border-l-2 border-slate-100 py-2 mt-1">
                            <div className="text-sm text-slate-500 leading-relaxed font-mono bg-slate-50/50 p-3 rounded-xl border border-slate-100 prose prose-sm max-w-none">
                                <ReactMarkdown>{content}</ReactMarkdown>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
