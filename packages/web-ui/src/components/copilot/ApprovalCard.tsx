
import { Check, X } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface ApprovalCardProps {
    message: string;
    onApprove: () => void;
    onReject: () => void;
    isPending?: boolean;
}

export function ApprovalCard({ message, onApprove, onReject, isPending = false }: ApprovalCardProps) {
    const { t } = useTranslation();
    return (
        <div
            className="w-full rounded-xl border border-amber-200 bg-amber-50/50 p-4 my-2 dark:border-amber-900/50 dark:bg-amber-950/30"
            role="group"
            aria-label={message}
        >
            <p className="text-sm text-slate-800 mb-4 font-medium dark:text-slate-100">{message}</p>

            <div className="flex gap-3">
                <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
                    onClick={onApprove}
                    disabled={isPending}
                    className="clash-copilot-primary flex-1 flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                >
                    <Check weight="bold" aria-hidden="true" />
                    {t('copilot.approvalCard.approve')}
                </motion.button>

                <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
                    onClick={onReject}
                    disabled={isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-warm-surface border border-warm-border text-slate-700 rounded-lg text-sm font-medium hover:bg-warm-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface dark:bg-warm-muted dark:text-slate-200 dark:hover:bg-warm-hover"
                >
                    <X weight="bold" aria-hidden="true" />
                    {t('copilot.approvalCard.reject')}
                </motion.button>
            </div>
        </div>
    );
}
