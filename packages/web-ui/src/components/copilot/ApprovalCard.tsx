
import { Check, X } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

interface ApprovalCardProps {
    message: string;
    onApprove: () => void;
    onReject: () => void;
    isPending?: boolean;
}

export function ApprovalCard({ message, onApprove, onReject, isPending = false }: ApprovalCardProps) {
    return (
        <div className="w-full rounded-xl border border-amber-200 bg-amber-50/50 p-4 my-2">
            <p className="text-sm text-slate-800 mb-4 font-medium">{message}</p>

            <div className="flex gap-3">
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onApprove}
                    disabled={isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Check weight="bold" />
                    Approve
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onReject}
                    disabled={isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <X weight="bold" />
                    Reject
                </motion.button>
            </div>
        </div>
    );
}
