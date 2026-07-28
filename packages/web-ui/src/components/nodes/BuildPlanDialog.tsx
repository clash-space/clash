import { memo, useId, useMemo } from "react";
import { Warning, WarningCircle, X, Play } from "@phosphor-icons/react";
import { summarizeInvocations, type BuildPlan } from "./buildPlan";
import { Dialog } from "../ui/dialog";
import { Tooltip } from "../ui/tooltip";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";

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
const BuildPlanDialog = ({
  open,
  targetLabel,
  plan,
  onConfirm,
  onCancel,
}: BuildPlanDialogProps) => {
  const invocationRows = useMemo(
    () => summarizeInvocations(plan.estimatedInvocations),
    [plan.estimatedInvocations],
  );
  const totalCalls = useMemo(
    () =>
      plan.estimatedInvocations.reduce(
        (total, estimate) => total + estimate.count,
        0,
      ),
    [plan.estimatedInvocations],
  );
  const canBuild =
    plan.blockers.length === 0 && plan.entries.length > 0 && !plan.cycle;
  const disabledReason = plan.cycle
    ? "Cycle detected"
    : (plan.blockers[0] ?? "Nothing to build");
  const confirmLabel = canBuild
    ? `Build ${plan.entries.length} draft${plan.entries.length === 1 ? "" : "s"}`
    : disabledReason;

  const headerId = useId();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      ariaLabel={`Build plan for ${targetLabel}`}
      size="lg"
      hideCloseButton
      unstyled
      overlayClassName="z-[9999]"
      containerClassName="z-[9999] p-3 sm:p-6 md:p-8"
      contentClassName="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] bg-warm-surface rounded-2xl shadow-lg border border-warm-border overflow-hidden flex flex-col motion-reduce:transition-none"
    >
      {/* Header */}
      <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex items-start justify-between gap-3 sm:gap-4 border-b border-warm-border shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-content-secondary">
            Build plan
          </div>
          <Tooltip label={targetLabel}>
            <h2
              id={headerId}
              className="truncate text-base font-bold text-content-primary sm:text-lg"
            >
              {targetLabel}
            </h2>
          </Tooltip>
        </div>
        <IconButton
          label="Close build plan dialog"
          icon={<X className="w-4 h-4" weight="bold" aria-hidden="true" />}
          onClick={onCancel}
          className="shrink-0 text-content-secondary hover:bg-warm-hover hover:text-content-primary"
        />
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto space-y-4 sm:space-y-5">
        {plan.cycle && (
          <div
            role="alert"
            className="clash-node-alert-error flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
          >
            <WarningCircle
              size={16}
              weight="fill"
              className="shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              Cycle detected in dependency graph. Resolve the cycle and try
              again.
            </div>
          </div>
        )}

        {plan.blockers.length > 0 && (
          <div role="alert" className="space-y-1">
            {plan.blockers.map((msg, i) => (
              <div
                key={i}
                className="clash-node-alert-error flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              >
                <WarningCircle
                  size={14}
                  weight="fill"
                  className="shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>{msg}</span>
              </div>
            ))}
          </div>
        )}

        {plan.warnings.length > 0 && (
          <div className="space-y-1">
            {plan.warnings.map((msg, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
              >
                <Warning
                  size={14}
                  weight="fill"
                  className="shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>{msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* Action breakdown */}
        {invocationRows.length > 0 && (
          <section aria-labelledby={`${headerId}-actions`}>
            <h3
              id={`${headerId}-actions`}
              className="mb-2 text-[10px] font-bold uppercase tracking-wider text-content-secondary"
            >
              Actions to invoke · {totalCalls} total
            </h3>
            <div className="rounded-xl border border-warm-border overflow-hidden">
              {invocationRows.map((row, i) => (
                <div
                  key={row.actionDefinitionRef}
                  className={`flex items-center justify-between px-3.5 py-2 text-sm ${
                    i > 0 ? "border-t border-warm-border" : ""
                  }`}
                >
                  <span className="truncate font-medium text-content-primary">
                    {row.actionDefinitionName}
                  </span>
                  <span className="shrink-0 rounded-md bg-warm-muted px-2 py-0.5 text-xs font-semibold text-content-primary">
                    <span aria-hidden="true">×</span>
                    <span className="sr-only"> invocations: </span>
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
            <h3
              id={`${headerId}-drafts`}
              className="mb-2 text-[10px] font-bold uppercase tracking-wider text-content-secondary"
            >
              Affected drafts · {plan.entries.length}
            </h3>
            <div className="rounded-xl border border-warm-border overflow-hidden">
              {plan.entries.map((entry, i) => (
                <div
                  key={entry.draftId}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2 text-xs ${
                    i > 0 ? "border-t border-warm-border" : ""
                  } ${!entry.actionDefinitionRef || (entry.kind === "model" && !entry.hasPrompt) ? "clash-node-row-error" : ""}`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand" />
                    <Tooltip label={entry.label}>
                      <span className="truncate text-content-primary">
                        {entry.label}
                      </span>
                    </Tooltip>
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-content-secondary">
                    {entry.modality}
                    {i === plan.entries.length - 1 ? " · target" : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-warm-border bg-warm-muted shrink-0">
        <Button
          onClick={onCancel}
          className="w-full rounded-lg border-transparent bg-transparent px-4 py-2 text-sm text-content-secondary shadow-none hover:bg-warm-hover hover:text-content-primary sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!canBuild}
          className="clash-node-primary w-full rounded-lg border-transparent px-4 py-2 text-sm font-semibold shadow-none sm:w-auto"
          aria-describedby={
            !canBuild ? `${headerId}-disabled-reason` : undefined
          }
          aria-label={confirmLabel}
          leftIcon={<Play size={11} weight="fill" aria-hidden="true" />}
        >
          Build {totalCalls > 0 ? `(${totalCalls})` : ""}
        </Button>
        {!canBuild && (
          <span id={`${headerId}-disabled-reason`} className="sr-only">
            {disabledReason}
          </span>
        )}
      </div>
    </Dialog>
  );
};

export default memo(BuildPlanDialog);
