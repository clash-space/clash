import { type MouseEvent } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { RevisionHistoryEntry } from "@clash/web-ui/hooks/useRevisionHistory";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface RevisionHistorySnapshot {
  count: number;
  latest: RevisionHistoryEntry | null;
  revisions: RevisionHistoryEntry[];
  loading: boolean;
  error: string | null;
}

export interface RevisionHistoryBadgeProps {
  nodeId: string;
  history: RevisionHistorySnapshot;
  onRestoreRevision?: (request: RevisionRestoreRequest) => void;
  className?: string;
  showWhenEmpty?: boolean;
  variant?: "badge" | "toolbar";
}

export interface RevisionRestoreRequest {
  kind: "text";
  nodeId: string;
  revisionId: string;
  mode: "replace";
  command: string;
}

export const REVISION_RESTORE_REQUEST_EVENT = "clash:revision-restore-request";

function recoveryCommand(revisionId: string): string {
  return `clash text content --revision ${shellArg(revisionId)} --out ${shellArg(`revisions/${revisionId}.md`)}`;
}

function restoreCommand(nodeId: string, revisionId: string): string {
  return `clash text restore --node ${shellArg(nodeId)} --revision ${shellArg(revisionId)} --mode replace`;
}

function revisionHash(revision: RevisionHistoryEntry): string | null {
  return revision.textHash ?? revision.content?.hash ?? null;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

export function RevisionHistoryBadge({
  nodeId,
  history,
  onRestoreRevision,
  className = "",
  showWhenEmpty = false,
  variant = "badge",
}: RevisionHistoryBadgeProps) {
  if (history.count === 0 && !showWhenEmpty) return null;

  const label = "Text revision history";
  const accessibleHistory =
    history.count === 0
      ? `${label}: no revisions`
      : `${label}: ${history.count} revision${history.count === 1 ? "" : "s"}, latest ${history.latest?.revisionId ?? "unknown"}`;
  const stopNodeGesture = (event: MouseEvent) => {
    event.stopPropagation();
  };
  const requestRestore = (request: RevisionRestoreRequest) => {
    if (onRestoreRevision) {
      onRestoreRevision(request);
      return;
    }
    if (typeof navigator !== "undefined") {
      void navigator.clipboard
        ?.writeText(request.command)
        .catch(() => undefined);
    }
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<RevisionRestoreRequest>(
          REVISION_RESTORE_REQUEST_EVENT,
          { detail: request },
        ),
      );
    }
  };

  return (
    <Popover>
      <div
        className={className}
        onClick={stopNodeGesture}
        onDoubleClick={stopNodeGesture}
        onPointerDown={stopNodeGesture}
      >
        <PopoverTrigger asChild>
          <Button
            variant={null}
            size={null}
            shape={null}
            className={
              variant === "toolbar"
                ? "clash-workbench-control-button inline-flex h-[var(--clash-project-control-height,2rem)] items-center gap-[var(--clash-control-gap,0.25rem)] px-2 text-xs font-medium text-content-muted transition-colors hover:bg-warm-hover hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                : "rounded-md border border-warm-border bg-warm-surface/95 px-2 py-1 text-[10px] font-semibold text-stone-700 shadow-sm transition-colors hover:bg-warm-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:text-stone-200"
            }
            aria-label={accessibleHistory}
          >
            {variant === "toolbar" ? (
              <>
                <ClockCounterClockwise className="h-3.5 w-3.5" weight="bold" />
                <span>History</span>
                {history.count > 0 ? (
                  <span className="tabular-nums text-content-disabled">
                    {history.count}
                  </span>
                ) : null}
              </>
            ) : (
              `${history.count} rev`
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          role="region"
          aria-label={`${label} panel`}
          side="bottom"
          align={variant === "toolbar" ? "start" : "end"}
          sideOffset={4}
          onClick={stopNodeGesture}
          onDoubleClick={stopNodeGesture}
          onPointerDown={stopNodeGesture}
          className="w-72 gap-0 p-2 text-[11px] text-stone-700 dark:text-stone-200"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{label}</span>
            {history.loading && <span className="text-stone-500">Loading</span>}
          </div>
          {history.error && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {history.error}
            </div>
          )}
          {!history.loading && !history.error && history.count === 0 ? (
            <div className="mt-2 rounded-md bg-warm-muted px-2 py-2 text-content-muted">
              No saved revisions yet.
            </div>
          ) : null}
          <ul className="mt-2 space-y-2">
            {history.revisions.map((revision) => {
              const hash = revisionHash(revision);
              const restore = restoreCommand(nodeId, revision.revisionId);
              const directRestore = Boolean(onRestoreRevision);
              return (
                <li
                  key={revision.revisionId}
                  className="border-t border-warm-border pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono font-semibold">
                      {revision.revisionId}
                    </span>
                    {revision.actor && <span>{revision.actor}</span>}
                    {revision.createdAt && (
                      <span className="text-stone-500">
                        {revision.createdAt}
                      </span>
                    )}
                  </div>
                  {revision.sourceFilePath && (
                    <div className="mt-1 break-all font-mono text-stone-600 dark:text-stone-300">
                      {revision.sourceFilePath}
                    </div>
                  )}
                  {hash && (
                    <div className="mt-1 break-all font-mono text-stone-600 dark:text-stone-300">
                      {hash}
                    </div>
                  )}
                  {restore && (
                    <>
                      <code className="mt-1 block break-all rounded-md bg-warm-muted px-2 py-1 font-mono text-[10px] leading-snug text-stone-800 dark:text-stone-100">
                        {recoveryCommand(revision.revisionId)}
                      </code>
                      <code className="mt-1 block break-all rounded-md bg-warm-muted px-2 py-1 font-mono text-[10px] leading-snug text-stone-800 dark:text-stone-100">
                        {restore}
                      </code>
                      <Button
                        variant={null}
                        size={null}
                        shape={null}
                        className="mt-1 inline-flex h-6 items-center rounded-md border border-warm-border bg-warm-surface px-2 text-[10px] font-semibold text-stone-700 transition-colors hover:bg-warm-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:text-stone-200"
                        aria-label={
                          directRestore
                            ? `Restore text revision ${revision.revisionId}`
                            : `Copy restore command for text revision ${revision.revisionId}`
                        }
                        onClick={() =>
                          requestRestore({
                            kind: "text",
                            nodeId,
                            revisionId: revision.revisionId,
                            mode: "replace",
                            command: restore,
                          })
                        }
                      >
                        {directRestore ? "Restore" : "Copy restore"}
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </div>
    </Popover>
  );
}
