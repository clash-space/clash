import { motion } from 'framer-motion';
import { Sparkle } from '@phosphor-icons/react';

interface ThinkingIndicatorProps {
    message?: string;
}

export function ThinkingIndicator({ message = 'Thinking' }: ThinkingIndicatorProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 px-1 py-2"
        >
            <span className="p-1 rounded-md bg-brand-light text-brand dark:bg-brand/15 dark:text-brand" aria-hidden="true">
                <motion.span
                    className="block motion-reduce:hidden"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                    <Sparkle className="w-3.5 h-3.5" weight="fill" />
                </motion.span>
                {/* Static fallback for reduced-motion users. */}
                <span className="hidden motion-reduce:block">
                    <Sparkle className="w-3.5 h-3.5" weight="fill" />
                </span>
            </span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {message}
                <motion.span
                    aria-hidden="true"
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, times: [0, 0.5, 1] }}
                >…</motion.span>
            </span>
        </motion.div>
    );
}
