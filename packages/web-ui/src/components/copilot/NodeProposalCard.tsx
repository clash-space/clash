import React from 'react';
import { Check, X, Play, Cube, MagicWand } from '@phosphor-icons/react';

import { Button } from '../ui/button';

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
        <div className="bg-warm-surface rounded-xl border border-warm-border shadow-sm overflow-hidden mb-4">
            <div className="p-4 border-b border-warm-border bg-warm-muted/60 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-light text-brand flex items-center justify-center shrink-0">
                    {isGenerative ? <MagicWand weight="fill" /> : <Cube weight="fill" />}
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-content-primary">
                        {isGenerative ? 'Generative Action Proposed' : 'New Node Proposed'}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                        {proposal.message}
                    </p>
                </div>
            </div>

            {/* Node Preview (Simplified) */}
            <div className="p-3 bg-warm-muted/35 border-b border-warm-border">
                <div className="bg-warm-surface border border-warm-border rounded-lg p-2 flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-warm-muted text-xs font-bold text-content-secondary">
                        {proposal.nodeType.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="truncate text-xs font-medium text-content-primary">
                            {proposal.nodeData.label || proposal.nodeType}
                        </div>
                        <div className="truncate text-[10px] text-content-secondary">
                            {JSON.stringify(proposal.nodeData)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3 flex items-center gap-2">
                <Button
                    size="sm"
                    onClick={onReject}
                    className="flex-1 rounded-lg px-3 py-2 text-xs text-content-secondary hover:bg-warm-hover hover:text-content-primary"
                >
                    <X className="w-3.5 h-3.5" />
                    Reject
                </Button>

                <Button
                    size="sm"
                    onClick={onAccept}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs ${isGenerative
                            ? 'text-content-secondary hover:bg-warm-hover hover:text-content-primary'
                            : 'clash-copilot-primary shadow-sm'
                        }`}
                >
                    <Check className="w-3.5 h-3.5" />
                    Accept
                </Button>

                {isGenerative && onAcceptAndRun && (
                    <Button
                        size="sm"
                        onClick={onAcceptAndRun}
                        className="clash-copilot-primary flex-1 rounded-lg px-3 py-2 text-xs shadow-sm"
                    >
                        <Play className="w-3.5 h-3.5" weight="fill" />
                        Accept & Run
                    </Button>
                )}
            </div>
        </div>
    );
};
