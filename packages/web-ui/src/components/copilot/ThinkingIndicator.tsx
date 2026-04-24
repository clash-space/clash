import { motion } from 'framer-motion';
import { Sparkle } from '@phosphor-icons/react';

interface ThinkingIndicatorProps {
    message?: string;
}

export function ThinkingIndicator({ message = "Thinking..." }: ThinkingIndicatorProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 px-1 py-2"
        >
            <div className="p-1 rounded-md bg-indigo-50 text-indigo-500">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                >
                    <Sparkle className="w-3.5 h-3.5" weight="fill" />
                </motion.div>
            </div>
            <span className="text-sm font-medium text-slate-600">
                {message}
                <motion.span
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1] }}
                >...</motion.span>
            </span>
        </motion.div>
    );
}
