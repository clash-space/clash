"use client";

// Plan — TodoWrite-style task list snapshot. Two visual modes:
//
//   <Plan />     — full block, used inline or in dialogs
//   <PlanBar />  — slim sticky footer (1 row, click to expand into a
//                  popover above) for per-agent bottom status. The
//                  whole-bubble version was distracting in chat flow;
//                  the bar lives at the agent tab footer instead and
//                  reflects the *latest* plan snapshot from the agent.

import * as React from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { PlanEntry } from "../../lib/acpEvents";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "./utils";

function statusIcon(status: string, size = "size-3.5") {
  const cls = cn(size, "shrink-0");
  if (status === "completed") return <CheckCircle2 className={cn(cls, "text-status-ready")} />;
  if (status === "in_progress")
    return <Loader2 className={cn(cls, "text-status-busy animate-spin")} />;
  return <Circle className={cn(cls, "text-muted-foreground")} />;
}

export interface PlanProps {
  entries: PlanEntry[];
  className?: string;
}

export function Plan({ entries, className }: PlanProps) {
  if (!entries || entries.length === 0) return null;
  const completed = entries.filter((e) => e.status === "completed").length;
  return (
    <div
      className={cn(
        "not-prose my-2 rounded-md border border-border bg-muted/40 px-3 py-2",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Plan</span>
        <span>
          {completed} / {entries.length}
        </span>
      </div>
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5">{statusIcon(e.status)}</span>
            <span
              className={cn(
                "leading-snug",
                e.status === "completed" && "text-muted-foreground line-through",
                e.status === "in_progress" && "text-foreground font-medium",
                e.status === "pending" && "text-foreground",
              )}
            >
              {e.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface PlanBarProps {
  entries: PlanEntry[];
  className?: string;
}

/**
 * Slim sticky footer variant. Header row is always visible
 * ("Plan • 5/9 • <current step>") and clicking expands the full
 * checklist upward as a popover so the message stream below stays
 * intact.
 */
export function PlanBar({ entries, className }: PlanBarProps) {
  const [open, setOpen] = React.useState(false);
  if (!entries || entries.length === 0) return null;
  const completed = entries.filter((e) => e.status === "completed").length;
  const inProgress = entries.find((e) => e.status === "in_progress");
  const pendingNext = entries.find((e) => e.status === "pending");
  const current = inProgress?.content ?? pendingNext?.content ?? "All done";
  const isDone = completed === entries.length;
  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label="Agent plan"
          className="max-h-[60vh] w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-xl border-warm-border/60 bg-background/95 p-2 shadow-lg backdrop-blur"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Plan entries={entries} className="my-0 border-0 bg-transparent p-0" />
        </PopoverContent>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "group/planbar flex h-8 w-full items-center gap-1.5 rounded-full bg-warm-muted/70 px-2.5 text-xs text-foreground transition-colors hover:bg-warm-muted",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
            aria-expanded={open}
            aria-label={open ? "Hide plan" : "Show plan"}
          >
            <span className="shrink-0 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">
              Plan
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {completed}/{entries.length}
            </span>
            {!isDone && inProgress && (
              <Loader2 className="size-3 shrink-0 text-status-busy animate-spin" aria-hidden="true" />
            )}
            <span className="truncate text-muted-foreground min-w-0 flex-1 text-left">
              {current}
            </span>
          </button>
        </PopoverTrigger>
      </Popover>
    </div>
  );
}
