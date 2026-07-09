import { useState, type MouseEvent } from "react";
import type { RevisionHistoryEntry, RevisionHistoryKind } from "@clash/web-ui/hooks/useRevisionHistory";

interface RevisionHistorySnapshot {
  count: number;
  latest: RevisionHistoryEntry | null;
  revisions: RevisionHistoryEntry[];
  loading: boolean;
  error: string | null;
}

export interface RevisionHistoryBadgeProps {
  kind: RevisionHistoryKind;
  nodeId: string;
  history: RevisionHistorySnapshot;
  className?: string;
}

function labelFor(kind: RevisionHistoryKind): string {
  return kind === "text" ? "Text revision history" : "Timeline revision history";
}

function recoveryCommand(kind: RevisionHistoryKind, revisionId: string): string {
  const extension = kind === "text" ? "md" : "timeline.yaml";
  return `clash ${kind} content --revision ${revisionId} --out revisions/${revisionId}.${extension}`;
}

function restoreCommand(kind: RevisionHistoryKind, nodeId: string, revisionId: string): string {
  return `clash ${kind} restore --node ${nodeId} --revision ${revisionId} --mode replace`;
}

function revisionHash(revision: RevisionHistoryEntry): string | null {
  return revision.textHash ?? revision.timelineHash ?? revision.content?.hash ?? null;
}

export function RevisionHistoryBadge({ kind, nodeId, history, className = "" }: RevisionHistoryBadgeProps) {
  const [open, setOpen] = useState(false);

  if (history.count === 0) return null;

  const label = labelFor(kind);
  const stopNodeGesture = (event: MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className={`relative ${className}`}
      onClick={stopNodeGesture}
      onDoubleClick={stopNodeGesture}
      onPointerDown={stopNodeGesture}
    >
      <button
        type="button"
        className="rounded-md border border-warm-border bg-warm-surface/95 px-2 py-1 text-[10px] font-semibold text-stone-700 shadow-sm transition-colors hover:bg-warm-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-stone-200"
        aria-label={`${label}: ${history.count} revision${history.count === 1 ? "" : "s"}, latest ${history.latest?.revisionId ?? "unknown"}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {history.count} rev
      </button>
      {open && (
        <div
          role="region"
          aria-label={`${label} panel`}
          className="absolute right-0 top-7 z-50 w-72 rounded-matrix border border-warm-border bg-warm-surface p-2 text-[11px] text-stone-700 shadow-lg dark:text-stone-200"
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
          <ul className="mt-2 space-y-2">
            {history.revisions.map((revision) => {
              const hash = revisionHash(revision);
              return (
                <li key={revision.revisionId} className="border-t border-warm-border pt-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono font-semibold">{revision.revisionId}</span>
                    {revision.actor && <span>{revision.actor}</span>}
                    {revision.createdAt && <span className="text-stone-500">{revision.createdAt}</span>}
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
                  <code className="mt-1 block break-all rounded-md bg-warm-muted px-2 py-1 font-mono text-[10px] leading-snug text-stone-800 dark:text-stone-100">
                    {recoveryCommand(kind, revision.revisionId)}
                  </code>
                  <code className="mt-1 block break-all rounded-md bg-warm-muted px-2 py-1 font-mono text-[10px] leading-snug text-stone-800 dark:text-stone-100">
                    {restoreCommand(kind, nodeId, revision.revisionId)}
                  </code>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
