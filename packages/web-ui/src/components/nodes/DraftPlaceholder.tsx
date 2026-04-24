import { memo, useCallback, useMemo, useState } from 'react';
import { useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Play, Image as ImageIcon, VideoCamera, TextT, SpeakerHigh } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { computeBuildPlan, type BuildPlan } from './buildPlan';
import BuildPlanDialog from './BuildPlanDialog';

type Modality = 'image' | 'video' | 'audio' | 'text';

interface DraftPlaceholderProps {
    nodeId: string;
    modality: Modality;
    width?: number | string;
    height?: number | string;
}

const MODALITY_ICON = {
    image: ImageIcon,
    video: VideoCamera,
    audio: SpeakerHigh,
    text: TextT,
} as const;

const MODALITY_LABEL: Record<Modality, string> = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    text: 'text',
};

/**
 * Placeholder rendered for a node in `status: 'draft'`.
 *
 * Single button: **Build** — triggers a reverse DAG evaluation from this node.
 * Clicking opens `BuildPlanDialog` showing the cohort of drafts that will run
 * (this one + every incomplete ancestor), the model invocation breakdown, and
 * any pre-flight blockers. On confirm, every draft in the plan is flagged
 * with `runRequested: true` + a shared `cascadeToken`; `useCascadeRunner`
 * drives each one through its gate → adoption → generation.
 *
 * The button label carries a `+N` suffix when there are draft ancestors, so
 * the user sees the cost footprint before opening the dialog.
 */
const DraftPlaceholder = ({ nodeId, modality, width, height }: DraftPlaceholderProps) => {
    const { setNodes } = useReactFlow();
    const nodes = useNodes();
    const edges = useEdges();
    const loroSync = useOptionalLoroSyncContext();
    const [dialogOpen, setDialogOpen] = useState(false);

    const Icon = MODALITY_ICON[modality];

    // Reverse-BFS plan. Runs on every canvas mutation; typical canvases are
    // small enough that this is cheap.
    const plan = useMemo<BuildPlan>(
        () => computeBuildPlan(nodeId, nodes as Parameters<typeof computeBuildPlan>[1], edges),
        [nodeId, nodes, edges],
    );

    const ancestorCount = Math.max(0, plan.entries.length - 1);
    const totalCalls = Array.from(plan.modelCounts.values()).reduce((a, b) => a + b, 0);
    const targetEntry = plan.entries[plan.entries.length - 1];
    const targetLabel = targetEntry?.label ?? 'this draft';

    const openDialog = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            setDialogOpen(true);
        },
        [],
    );

    const closeDialog = useCallback(() => setDialogOpen(false), []);

    const confirm = useCallback(() => {
        const token = `cascade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const draftIds = new Set(plan.entries.map((e) => e.draftId));
        setNodes((nds) =>
            nds.map((n) => {
                if (!draftIds.has(n.id)) return n;
                return { ...n, data: { ...n.data, runRequested: true, cascadeToken: token } };
            }),
        );
        if (loroSync?.connected) {
            for (const id of draftIds) {
                loroSync.updateNode(id, { data: { runRequested: true, cascadeToken: token } });
            }
        }
        setDialogOpen(false);
    }, [plan, setNodes, loroSync]);

    const buttonDisabled = plan.cycle || plan.entries.length === 0;
    const suffix = ancestorCount > 0 ? ` +${ancestorCount}` : '';
    const buttonTitle = plan.cycle
        ? 'Cycle detected'
        : plan.blockers.length > 0
            ? 'Has blockers — open to review'
            : totalCalls > 0
                ? `Will run ${totalCalls} model call${totalCalls === 1 ? '' : 's'}`
                : 'Build this draft';

    return (
        <>
            <div
                className="relative rounded-matrix bg-slate-50/60 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-3 p-4"
                style={{ width: width ?? '100%', height: height ?? '100%' }}
                role="group"
                aria-label={`Draft ${MODALITY_LABEL[modality]} placeholder`}
            >
                <div className="flex flex-col items-center gap-1 text-slate-500">
                    <Icon size={28} weight="duotone" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Draft {MODALITY_LABEL[modality]}</span>
                </div>
                <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
                    <motion.button
                        type="button"
                        onClick={openDialog}
                        disabled={buttonDisabled}
                        whileHover={buttonDisabled ? undefined : { x: 1 }}
                        whileTap={buttonDisabled ? undefined : { scale: 0.97 }}
                        className="flex items-center justify-center gap-1.5 min-h-11 rounded-full bg-slate-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 transition-colors cursor-pointer motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                        title={buttonTitle}
                        aria-label={
                            buttonDisabled
                                ? buttonTitle
                                : ancestorCount > 0
                                    ? `Build — ${totalCalls} model call${totalCalls === 1 ? '' : 's'}, ${ancestorCount} upstream draft${ancestorCount === 1 ? '' : 's'}`
                                    : `Build this draft`
                        }
                    >
                        <Play size={12} weight="fill" aria-hidden="true" />
                        <span aria-hidden="true">Build{suffix}</span>
                    </motion.button>
                </div>
            </div>

            <BuildPlanDialog
                open={dialogOpen}
                targetLabel={targetLabel}
                plan={plan}
                onConfirm={confirm}
                onCancel={closeDialog}
            />
        </>
    );
};

export default memo(DraftPlaceholder);
