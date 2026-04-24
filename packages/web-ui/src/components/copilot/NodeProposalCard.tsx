import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, Play, Cube, MagicWand } from '@phosphor-icons/react';

export interface NodeProposal {
    id: string;
    type: 'simple' | 'generative';
    nodeType: string;
    nodeData: any;
    upstreamNodeIds?: string[];
    message: string;
    assetId?: string; // Pre-allocated asset ID for generation nodes
}

interface NodeProposalCardProps {
    proposal: NodeProposal;
    onAccept: () => void;
    onReject: () => void;
    onAcceptAndRun?: () => void;
}

export const NodeProposalCard: React.FC<NodeProposalCardProps> = ({
    proposal,
    onAccept,
    onReject,
    onAcceptAndRun
}) => {
    const isGenerative = proposal.type === 'generative';

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    {isGenerative ? <MagicWand weight="fill" /> : <Cube weight="fill" />}
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                        {isGenerative ? 'Generative Action Proposed' : 'New Node Proposed'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {proposal.message}
                    </p>
                </div>
            </div>

            {/* Node Preview (Simplified) */}
            <div className="p-3 bg-slate-50/30 border-b border-slate-100">
                <div className="bg-white border border-slate-200 rounded-lg p-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400">
                        {proposal.nodeType.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-700 truncate">
                            {proposal.nodeData.label || proposal.nodeType}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                            {JSON.stringify(proposal.nodeData)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3 flex items-center gap-2">
                <motion.button
                    onClick={onReject}
                    className="flex-1 py-2 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                >
                    <X className="w-3.5 h-3.5" />
                    Reject
                </motion.button>

                <motion.button
                    onClick={onAccept}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${isGenerative
                            ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                        }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                >
                    <Check className="w-3.5 h-3.5" />
                    Accept
                </motion.button>

                {isGenerative && onAcceptAndRun && (
                    <motion.button
                        onClick={onAcceptAndRun}
                        className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 shadow-sm transition-colors flex items-center justify-center gap-1.5"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <Play className="w-3.5 h-3.5" weight="fill" />
                        Accept & Run
                    </motion.button>
                )}
            </div>
        </div>
    );
};
