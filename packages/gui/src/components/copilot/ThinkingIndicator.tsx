import { motion } from 'framer-motion';
import { Sparkle } from '@phosphor-icons/react';

interface ThinkingIndicatorProps {
    message?: string;
    variant?: 'label' | 'dots';
}

export function ThinkingIndicator({ message = 'Thinking', variant = 'label' }: ThinkingIndicatorProps) {
    if (variant === 'dots') {
        return (
            <motion.div
                role="status"
                aria-label={`${message} activity`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.2 }}
                className="inline-flex items-center gap-1.5 px-1 py-2"
            >
                {[0, 1, 2].map((index) => (
                    <motion.span
                        key={index}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-stone-400 dark:bg-stone-300"
                        animate={{ opacity: [0.18, 1, 0.18], scale: [0.72, 1.35, 0.72] }}
                        transition={{
                            duration: 1.15,
                            repeat: Infinity,
                            delay: index * 0.18,
                            ease: 'easeInOut',
                        }}
                    />
                ))}
            </motion.div>
        );
    }

    return (
        <motion.div
            role="status"
            aria-label={message}
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
