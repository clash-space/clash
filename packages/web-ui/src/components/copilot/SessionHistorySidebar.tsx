import type { ReactNode } from "react";
import {
  Archive,
  ArrowBendDownRight,
  DotsThree,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../ai-elements/utils";

export type SessionHistoryItem = {
  id?: string;
  threadId: string;
  title?: string;
  type: "cloud" | "runtime";
  projectId?: string;
  runtimeId?: string;
  agentId?: string;
  agentMemberId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: string;
  archivedAt?: string;
  updatedAt?: string;
};

type SessionHistorySidebarProps = {
  activeSessions: SessionHistoryItem[];
  activeSessionId?: string;
  onSelect: (session: SessionHistoryItem) => void;
  onFork: (session: SessionHistoryItem) => void;
  onArchive?: (threadId: string) => void | Promise<void>;
  onClose: () => void;
  className?: string;
};

export function SessionHistorySidebar({
  activeSessions,
  activeSessionId,
  onSelect,
  onFork,
  onArchive,
  onClose,
  className,
}: SessionHistorySidebarProps) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t("copilot.history.title")}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col border-l border-warm-border bg-warm-muted/35",
        className,
      )}
      data-session-history-sidebar=""
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-content-primary">
          {t("copilot.history.title")}
        </div>
        <IconButton
          label={t("copilot.history.close")}
          size="sm"
          onClick={onClose}
          icon={<X className="h-4 w-4" weight="bold" />}
          className="clash-workspace-icon-control"
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2 outline-none"
      >
        <SessionList
          sessions={activeSessions}
          activeSessionId={activeSessionId}
          emptyLabel={t("copilot.history.empty")}
          onSelect={(session) => {
            onSelect(session);
            onClose();
          }}
          actions={(session) => (
            <ActiveSessionActions
              session={session}
              onFork={onFork}
              onArchive={onArchive}
            />
          )}
        />
      </div>
    </aside>
  );
}

function SessionList({
  sessions,
  activeSessionId,
  emptyLabel,
  onSelect,
  actions,
}: {
  sessions: SessionHistoryItem[];
  activeSessionId?: string;
  emptyLabel: string;
  onSelect?: (session: SessionHistoryItem) => void;
  actions: (session: SessionHistoryItem) => ReactNode;
}) {
  const { t } = useTranslation();
  if (sessions.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-xs leading-5 text-content-secondary">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-warm-border/70">
      {sessions.map((session, index) => {
        const title =
          session.title ||
          t("copilot.history.fallbackTitle", { index: index + 1 });
        return (
          <li key={session.threadId} className="py-1">
            <div
              className={`group flex min-h-14 items-center gap-1 rounded-lg px-1.5 transition-colors ${
                activeSessionId === session.threadId
                  ? "bg-warm-surface"
                  : "hover:bg-warm-hover"
              }`}
            >
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(session)}
                  aria-current={
                    activeSessionId === session.threadId ? "page" : undefined
                  }
                  aria-label={`${title} ${session.threadId.slice(-6)}`}
                  className="min-w-0 flex-1 px-1.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <SessionRowText title={title} session={session} />
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-1.5 py-2 text-left">
                  <SessionRowText title={title} session={session} />
                </div>
              )}
              {actions(session)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveSessionActions({
  session,
  onFork,
  onArchive,
}: {
  session: SessionHistoryItem;
  onFork: (session: SessionHistoryItem) => void;
  onArchive?: (threadId: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const title = session.title || session.threadId;
  return (
    <SessionActionsMenu title={title}>
      {session.type === "runtime" && session.acpSessionId ? (
        <DropdownMenuItem onSelect={() => onFork(session)}>
          <ArrowBendDownRight className="h-4 w-4" />
          {t("copilot.history.fork")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={() => void onArchive?.(session.threadId)}>
        <Archive className="h-4 w-4" />
        {t("copilot.history.archive")}
      </DropdownMenuItem>
    </SessionActionsMenu>
  );
}

function SessionRowText({
  title,
  session,
}: {
  title: string;
  session: SessionHistoryItem;
}) {
  return (
    <>
      <span className="block truncate text-[13px] font-medium leading-5 text-content-primary">
        {title}
      </span>
      <span className="block truncate text-[11px] leading-4 text-content-secondary">
        {sessionMetadata(session)}
      </span>
    </>
  );
}

function SessionActionsMenu({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t("copilot.history.actions", { title })}
          size="sm"
          icon={<DotsThree className="h-4 w-4" weight="bold" />}
          className="h-8 min-h-8 w-8 min-w-8 shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sessionMetadata(session: SessionHistoryItem): string {
  const identity =
    session.agentId || (session.type === "runtime" ? "Local" : "Cloud");
  const timestamp = session.archivedAt || session.updatedAt;
  if (!timestamp) return identity;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return identity;
  return `${identity} · ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date)}`;
}
