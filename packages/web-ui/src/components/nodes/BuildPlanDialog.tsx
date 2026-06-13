
import { memo, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Warning, WarningCircle, X, Play } from '@phosphor-icons/react';
import { summarizeModelCounts, type BuildPlan } from './buildPlan';
import { useDialogA11y } from '@clash/web-ui/hooks/useDialogA11y';

interface BuildPlanDialogProps {
    open: boolean;
    targetLabel: string;
    plan: BuildPlan;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Pre-run confirmation modal for `Build`. Shows the full DAG expansion so the
 * user sees exactly which models will fire, how many times each, and which
 * drafts are affected. Blockers disable the Build button; warnings are
 * advisory.
 */
const BuildPlanDialog = ({ open, targetLabel, plan, onConfirm, onCancel }: BuildPlanDialogProps) => {
    const modelRows = useMemo(() => summarizeModelCounts(plan.modelCounts), [plan.modelCounts]);
    const totalCalls = useMemo(
        () => Array.from(plan.modelCounts.values()).reduce((a, b) => a + b, 0),
        [plan.modelCounts],
    );
    const canBuild = plan.blockers.length === 0 && plan.entries.length > 0 && !plan.cycle;

    const headerId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    useDialogA11y(dialogRef, { open, onClose: onCancel });

    const content = (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 md:p-8">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-warm-page/75 backdrop-blur-sm"
                        onClick={onCancel}
                        aria-hidden="true"
                    />
                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={headerId}
                        initial={{ opacity: 0, scale: 0.95, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 12 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 340 }}
                        className="relative z-10 w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] bg-warm-surface rounded-2xl shadow-lg border border-warm-border overflow-hidden flex flex-col motion-reduce:transition-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex items-start justify-between gap-3 sm:gap-4 border-b border-warm-border shrink-0">
                            <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Build plan</div>
                                <h2 id={headerId} className="text-base sm:text-lg font-bold text-slate-900 truncate" title={targetLabel}>
                                    {targetLabel}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                aria-label="Close build plan dialog"
                                className="shrink-0 p-2.5 text-slate-700 dark:text-slate-300 hover:text-slate-950 hover:bg-warm-hover rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            >
                                <X className="w-4 h-4" weight="bold" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="px-4 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto space-y-4 sm:space-y-5">
                            {plan.cycle && (
                                <div role="alert" className="clash-node-alert-error flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs">
                                    <WarningCircle size={16} weight="fill" className="shrink-0 mt-0.5" aria-hidden="true" />
                                    <div>Cycle detected in dependency graph. Resolve the cycle and try again.</div>
                                </div>
                            )}

                            {plan.blockers.length > 0 && (
                                <div role="alert" className="space-y-1">
                                    {plan.blockers.map((msg, i) => (
                                        <div key={i} className="clash-node-alert-error flex items-start gap-2 rounded-lg px-3 py-2 text-xs">
                                            <WarningCircle size={14} weight="fill" className="shrink-0 mt-0.5" aria-hidden="true" />
                                            <span>{msg}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {plan.warnings.length > 0 && (
                                <div className="space-y-1">
                                    {plan.warnings.map((msg, i) => (
                                        <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                                            <Warning size={14} weight="fill" className="shrink-0 mt-0.5" aria-hidden="true" />
                                            <span>{msg}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Model breakdown */}
                            {modelRows.length > 0 && (
                                <section aria-labelledby={`${headerId}-models`}>
                                    <h3 id={`${headerId}-models`} className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                                        Models to invoke · {totalCalls} total
                                    </h3>
                                    <div className="rounded-xl border border-warm-border overflow-hidden">
                                        {modelRows.map((row, i) => (
                                            <div
                                                key={row.modelId}
                                                className={`flex items-center justify-between px-3.5 py-2 text-sm ${
                                                    i > 0 ? 'border-t border-warm-border' : ''
                                                }`}
                                            >
                                                <span className="font-medium text-slate-800 truncate">{row.modelName}</span>
                                                <span className="shrink-0 px-2 py-0.5 rounded-md bg-warm-muted text-slate-800 dark:text-slate-200 text-xs font-semibold">
                                                    <span aria-hidden="true">×</span>
                                                    <span className="sr-only">{' '}invocations: </span>
                                                    {row.count}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Affected nodes */}
                            {plan.entries.length > 0 && (
                                <section aria-labelledby={`${headerId}-drafts`}>
                                    <h3 id={`${headerId}-drafts`} className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                                        Affected drafts · {plan.entries.length}
                                    </h3>
                                    <div className="rounded-xl border border-warm-border overflow-hidden">
                                        {plan.entries.map((entry, i) => (
                                            <div
                                                key={entry.draftId}
                                                className={`flex items-center justify-between gap-3 px-3.5 py-2 text-xs ${
                                                    i > 0 ? 'border-t border-warm-border' : ''
                                                } ${!entry.hasPrompt || !entry.modelId ? 'clash-node-row-error' : ''}`}
                                            >
                                                <div className="min-w-0 flex items-center gap-2">
                                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand" />
                                                    <span className="truncate text-slate-800 dark:text-slate-200" title={entry.label}>{entry.label}</span>
                                                </div>
                                                <span className="shrink-0 text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                                                    {entry.modality}{i === plan.entries.length - 1 ? ' · target' : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-warm-border bg-warm-muted shrink-0">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="w-full sm:w-auto min-h-11 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-warm-hover rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={onConfirm}
                                disabled={!canBuild}
                                className="clash-node-primary flex items-center justify-center gap-1.5 w-full sm:w-auto min-h-11 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                                aria-describedby={!canBuild ? `${headerId}-disabled-reason` : undefined}
                                title={
                                    !canBuild
                                        ? plan.cycle
                                            ? 'Cycle detected'
                                            : plan.blockers[0] ?? 'Nothing to build'
                                        : `Build ${plan.entries.length} draft${plan.entries.length === 1 ? '' : 's'}`
                                }
                            >
                                <Play size={11} weight="fill" aria-hidden="true" />
                                Build {totalCalls > 0 ? `(${totalCalls})` : ''}
                            </button>
                            {!canBuild && (
                                <span id={`${headerId}-disabled-reason`} className="sr-only">
                                    {plan.cycle ? 'Cycle detected' : plan.blockers[0] ?? 'Nothing to build'}
                                </span>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    if (typeof window === 'undefined') return null;
    return createPortal(content, document.body);
};

export default memo(BuildPlanDialog);
