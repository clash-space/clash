import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  PauseCircle,
  Robot,
  Square,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { cn } from "../ai-elements/utils";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Sheet, SheetContent, SheetOverlay, SheetTitle } from "../ui/sheet";

export type SubagentWorkItemStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

/**
 * GUI projection of Backchat-compatible work_item.* state. Transcript events
 * intentionally stay outside this type so callers can keep using the shared
 * ACP renderer (including Clash's Canvas, Timeline, and terminal treatments).
 */
export interface SubagentWorkItem {
  id: string;
  title: string;
  status: SubagentWorkItemStatus;
  agentType?: string;
  detail?: string;
}

interface SubagentActivityRowProps {
  item: SubagentWorkItem;
  onOpen: (item: SubagentWorkItem) => void;
  className?: string;
}

interface SubagentActivityDockProps {
  items: readonly SubagentWorkItem[];
  onOpen: (item: SubagentWorkItem) => void;
  onStop?: (workItemId: string) => void;
  onStopAll?: () => void;
  /** Positioned Copilot panel element used as the popover portal and collision boundary. */
  portalContainer?: HTMLElement | null;
  /** Resolves a panel ref at open time when it was not populated during the parent render. */
  getPortalContainer?: () => HTMLElement | null;
  className?: string;
}

interface SubagentDetailPanelProps {
  open: boolean;
  item: SubagentWorkItem | null;
  onClose: () => void;
  onStop?: (workItemId: string) => void;
  children: ReactNode;
  /**
   * Supply the real runtime-backed follow-up composer. When absent, the
   * transcript remains read-only instead of exposing a decorative input.
   */
  composer?: ReactNode;
  /** Positioned Copilot panel element used as the Radix portal boundary. */
  portalContainer?: HTMLElement | null;
  /** Resolves the latest panel node after an outer animated surface commits. */
  getPortalContainer?: () => HTMLElement | null;
}

function connectedPortalContainer(container: HTMLElement | null | undefined): HTMLElement | null {
  return container?.isConnected ? container : null;
}

function statusIcon(status: SubagentWorkItemStatus): ReactNode {
  if (status === "running") {
    return (
      <CircleNotch
        className="h-3.5 w-3.5 animate-spin text-brand motion-reduce:animate-none"
        weight="bold"
        aria-hidden="true"
      />
    );
  }
  if (status === "completed") {
    return <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" weight="fill" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <WarningCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" weight="fill" aria-hidden="true" />;
  }
  if (status === "cancelled") {
    return <PauseCircle className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" weight="fill" aria-hidden="true" />;
  }
  return <WarningCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" weight="fill" aria-hidden="true" />;
}

function useStatusLabel(status: SubagentWorkItemStatus): string {
  const { t } = useTranslation();
  return t(`copilot.subagent.status.${status}`);
}

function WorkItemIdentity({ item }: { item: SubagentWorkItem }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {statusIcon(item.status)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-content-primary">{item.title}</span>
          {item.agentType ? (
            <span className="shrink-0 text-xs text-content-muted">{item.agentType}</span>
          ) : null}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block truncate text-xs leading-5 text-content-secondary">{item.detail}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Inline projection placed next to the parent agent's spawn/tool activity. */
export function SubagentActivityRow({ item, onOpen, className }: SubagentActivityRowProps) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel(item.status);

  return (
    <Button
      variant={null}
      size={null}
      shape={null}
      onClick={() => onOpen(item)}
      aria-label={t("copilot.subagent.openTask", { title: item.title })}
      className={cn(
        "group/subagent-row flex w-full min-h-0 items-center justify-start gap-2 rounded-lg px-1.5 py-1.5 text-left",
        "hover:bg-warm-muted/70 focus-visible:ring-brand focus-visible:ring-offset-warm-page",
        className,
      )}
    >
      <WorkItemIdentity item={item} />
      <span className="shrink-0 text-xs text-content-muted">{statusLabel}</span>
      <CaretRight
        className="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform group-hover/subagent-row:translate-x-0.5 motion-reduce:transition-none"
        weight="bold"
        aria-hidden="true"
      />
    </Button>
  );
}

/** Compact activity control anchored immediately above the main composer. */
export function SubagentActivityDock({
  items,
  onOpen,
  onStop,
  onStopAll,
  portalContainer,
  getPortalContainer,
  className,
}: SubagentActivityDockProps) {
  const { t } = useTranslation();
  const [resolvedPortalContainer, setResolvedPortalContainer] = useState(
    connectedPortalContainer(portalContainer),
  );
  const activePortalContainer = connectedPortalContainer(resolvedPortalContainer)
    ?? connectedPortalContainer(portalContainer);
  const runningItems = items.filter((item) => item.status === "running");
  if (runningItems.length === 0) return null;

  const workingLabel = t("copilot.subagent.workingCount", { count: runningItems.length });

  return (
    <div className={cn("flex w-full justify-start", className)}>
      <Popover
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setResolvedPortalContainer(
              connectedPortalContainer(getPortalContainer?.() ?? portalContainer),
            );
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            size="sm"
            shape="pill"
            className="min-h-8 gap-2 border-overlay-border bg-overlay-surface px-3 text-content-secondary shadow-none hover:text-content-primary"
            aria-label={workingLabel}
          >
            <Robot className="h-3.5 w-3.5 text-brand" weight="duotone" aria-hidden="true" />
            {workingLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          collisionBoundary={activePortalContainer ?? undefined}
          portalContainer={activePortalContainer}
          role="dialog"
          aria-label={t("copilot.subagent.activityTitle")}
          className="w-[min(32rem,var(--radix-popover-content-available-width))] overflow-hidden rounded-xl p-0"
        >
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-overlay-border px-3 py-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-sm font-semibold text-content-primary">{workingLabel}</span>
              <span className="text-xs text-content-muted">{t("copilot.subagent.activityTitle")}</span>
            </div>
            {onStopAll ? (
              <Button
                variant={null}
                size={null}
                shape={null}
                onClick={onStopAll}
                aria-label={t("copilot.subagent.stopAllLabel")}
                className="min-h-8 rounded-lg px-2 text-xs text-content-secondary hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
              >
                {t("copilot.subagent.stopAll")}
              </Button>
            ) : null}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {runningItems.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center rounded-lg hover:bg-warm-muted/70">
                <Button
                  variant={null}
                  size={null}
                  shape={null}
                  onClick={() => onOpen(item)}
                  aria-label={t("copilot.subagent.openTask", { title: item.title })}
                  className="min-h-0 min-w-0 flex-1 justify-start rounded-lg px-2 py-2 text-left hover:bg-transparent focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <WorkItemIdentity item={item} />
                </Button>
                {onStop ? (
                  <IconButton
                    label={t("copilot.subagent.stopTask", { title: item.title })}
                    icon={<Square className="h-3 w-3" weight="fill" />}
                    size="sm"
                    variant="destructive"
                    onClick={() => onStop(item.id)}
                    className="mr-1 shrink-0"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Right-side task transcript sheet that preserves the parent conversation. */
export function SubagentDetailPanel({
  open,
  item,
  onClose,
  onStop,
  children,
  composer,
  portalContainer,
  getPortalContainer,
}: SubagentDetailPanelProps) {
  const { t } = useTranslation();
  const [resolvedPortalContainer, setResolvedPortalContainer] = useState(
    connectedPortalContainer(portalContainer),
  );
  useLayoutEffect(() => {
    if (!open) return;
    const nextContainer = connectedPortalContainer(getPortalContainer?.() ?? portalContainer);
    setResolvedPortalContainer((current) => current === nextContainer ? current : nextContainer);
  }, [getPortalContainer, open, portalContainer]);
  const activePortalContainer = connectedPortalContainer(resolvedPortalContainer)
    ?? connectedPortalContainer(portalContainer);
  const statusLabel = useStatusLabel(item?.status ?? "unknown");
  if (!item) return null;

  return (
    <Sheet open={open}>
      <SheetOverlay
        portalContainer={activePortalContainer}
        onClick={onClose}
        className="absolute inset-0 z-[70] bg-black/30 [backdrop-filter:blur(4px)]"
      />
      <SheetContent
        portalContainer={activePortalContainer}
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onClose();
        }}
        className={cn(
          "absolute inset-y-0 right-0 z-[71] flex h-full w-3/4 max-w-sm flex-col overflow-hidden",
          "border-l border-warm-border bg-warm-page shadow-[-12px_0_32px_-18px_rgba(15,23,42,0.35)]",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
        )}
      >
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-warm-border bg-warm-surface px-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle asChild>
                <h2 className="truncate text-sm font-semibold text-content-primary">{item.title}</h2>
              </SheetTitle>
              {item.agentType ? <span className="shrink-0 text-xs text-content-muted">{item.agentType}</span> : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-content-secondary">
              {statusIcon(item.status)}
              <span>{statusLabel}</span>
              {item.detail ? <span className="truncate text-content-muted">· {item.detail}</span> : null}
            </div>
          </div>
          {item.status === "running" && onStop ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onStop(item.id)}
              leftIcon={<Square className="h-3 w-3" weight="fill" />}
              aria-label={t("copilot.subagent.stopTask", { title: item.title })}
              className="min-h-8"
            >
              {t("copilot.subagent.stop")}
            </Button>
          ) : null}
          <IconButton
            label={t("copilot.subagent.close")}
            icon={<X className="h-4 w-4" weight="bold" />}
            size="md"
            onClick={onClose}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {composer ? (
          <div className="shrink-0 border-t border-warm-border bg-warm-page px-3 pb-3 pt-2">{composer}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
