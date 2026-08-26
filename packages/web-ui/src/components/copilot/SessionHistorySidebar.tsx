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
        "app-rail-surface flex h-full w-60 shrink-0 flex-col border-l border-warm-border",
        className,
      )}
      data-session-history-sidebar=""
    >
      <div className="flex h-[38px] shrink-0 items-center gap-2 px-2">
        <div className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-content-secondary">
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

      <div className="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
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
    <ul className="space-y-0.5">
      {sessions.map((session, index) => {
        const title =
          session.title ||
          t("copilot.history.fallbackTitle", { index: index + 1 });
        return (
          <li key={session.threadId}>
            <div
              data-session-history-row="true"
              className={`group flex h-6 items-center gap-2 rounded-md px-2 text-xs transition-colors ${
                activeSessionId === session.threadId
                  ? "app-selected-surface text-content-primary"
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
                  className="flex h-full min-w-0 flex-1 items-center text-left outline-none focus-visible:text-content-primary"
                >
                  <SessionRowText title={title} session={session} />
                </button>
              ) : (
                <div className="flex h-full min-w-0 flex-1 items-center text-left">
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
      <span className="block truncate text-xs leading-5 text-content-primary">
        {title}
      </span>
      <span className="sr-only">{sessionMetadata(session)}</span>
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
        <button
          type="button"
          aria-label={t("copilot.history.actions", { title })}
          className="sidebar-row-action shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <DotsThree className="h-3.5 w-3.5" weight="bold" />
        </button>
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
