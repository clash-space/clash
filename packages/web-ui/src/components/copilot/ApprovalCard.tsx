
import { Check, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';

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
                <Button
                    onClick={onApprove}
                    disabled={isPending}
                    className="clash-copilot-primary flex-1 gap-2 rounded-lg px-4 py-2.5 text-sm focus-visible:ring-offset-warm-surface"
                >
                    <Check weight="bold" aria-hidden="true" />
                    {t('copilot.approvalCard.approve')}
                </Button>

                <Button
                    onClick={onReject}
                    disabled={isPending}
                    className="flex-1 gap-2 rounded-lg px-4 py-2.5 text-sm text-slate-700 hover:bg-warm-muted focus-visible:ring-offset-warm-surface dark:bg-warm-muted dark:text-slate-200 dark:hover:bg-warm-hover"
                >
                    <X weight="bold" aria-hidden="true" />
                    {t('copilot.approvalCard.reject')}
                </Button>
            </div>
        </div>
    );
}
