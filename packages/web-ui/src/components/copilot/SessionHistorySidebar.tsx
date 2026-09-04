import { useRef, useState, type ReactNode, type UIEvent } from "react";
import {
  Archive,
  ArrowBendDownRight,
  DotsThree,
  PencilSimple,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

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
  supportsSessionFork?: boolean;
  status?: string;
  archivedAt?: string;
  updatedAt?: string;
};

type SessionHistoryPopoverPanelProps = {
  activeSessions: SessionHistoryItem[];
  activeSessionId?: string;
  onSelect: (session: SessionHistoryItem) => void;
  onFork: (session: SessionHistoryItem) => void;
  onArchive?: (threadId: string) => void | Promise<void>;
  onRename?: (threadId: string, title: string) => void | Promise<void>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  onClose: () => void;
  className?: string;
};

export function SessionHistoryPopoverPanel({
  activeSessions,
  activeSessionId,
  onSelect,
  onFork,
  onArchive,
  onRename,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onClose,
  className,
}: SessionHistoryPopoverPanelProps) {
  const { t } = useTranslation();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const renameCommittedRef = useRef(false);
  const loadRequestedRef = useRef(false);

  const beginRename = (session: SessionHistoryItem) => {
    renameCommittedRef.current = false;
    setEditingSessionId(session.threadId);
    setDraftTitle(session.title?.trim() || session.threadId);
  };

  const cancelRename = () => {
    renameCommittedRef.current = false;
    setEditingSessionId(null);
  };

  const commitRename = (session: SessionHistoryItem) => {
    if (renameCommittedRef.current) return;
    const title = draftTitle.trim();
    if (!title) {
      cancelRename();
      return;
    }
    renameCommittedRef.current = true;
    setEditingSessionId(null);
    if (title !== session.title?.trim()) {
      void Promise.resolve(onRename?.(session.threadId, title)).catch(
        () => undefined,
      );
    }
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasMore || isLoadingMore || !onLoadMore || loadRequestedRef.current) {
      return;
    }
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight > 32)
      return;
    loadRequestedRef.current = true;
    void Promise.resolve(onLoadMore())
      .catch(() => undefined)
      .finally(() => {
        loadRequestedRef.current = false;
      });
  };

  return (
    <div
      className={cn(
        "flex max-h-[min(28rem,calc(100dvh-5rem))] min-h-0 flex-col",
        className,
      )}
      data-session-history-popover-panel=""
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto p-2 outline-none"
        data-session-history-scroll=""
        onScroll={handleScroll}
      >
        <SessionList
          sessions={activeSessions}
          activeSessionId={activeSessionId}
          emptyLabel={t("copilot.history.empty")}
          editingSessionId={editingSessionId}
          draftTitle={draftTitle}
          onDraftTitleChange={setDraftTitle}
          onRenameCommit={commitRename}
          onRenameCancel={cancelRename}
          onSelect={(session) => {
            onSelect(session);
            onClose();
          }}
          actions={(session) => (
            <ActiveSessionActions
              session={session}
              onFork={onFork}
              onArchive={onArchive}
              onRename={onRename ? () => beginRename(session) : undefined}
            />
          )}
        />
        {isLoadingMore ? (
          <div
            className="space-y-0.5 pt-0.5"
            role="status"
            aria-label={t("copilot.history.loadingMore")}
          >
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-6 rounded-md bg-warm-muted"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  activeSessionId,
  emptyLabel,
  editingSessionId,
  draftTitle,
  onDraftTitleChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  actions,
}: {
  sessions: SessionHistoryItem[];
  activeSessionId?: string;
  emptyLabel: string;
  editingSessionId: string | null;
  draftTitle: string;
  onDraftTitleChange: (title: string) => void;
  onRenameCommit: (session: SessionHistoryItem) => void;
  onRenameCancel: () => void;
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
              {editingSessionId === session.threadId ? (
                <form
                  className="flex h-full min-w-0 flex-1 items-center"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onRenameCommit(session);
                  }}
                >
                  <input
                    autoFocus
                    aria-label={t("copilot.history.renameLabel", { title })}
                    className="h-5 min-w-0 flex-1 rounded-sm border border-warm-border bg-warm-surface px-1 text-xs leading-5 text-content-primary outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
                    value={draftTitle}
                    onChange={(event) => onDraftTitleChange(event.target.value)}
                    onBlur={() => onRenameCommit(session)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onRenameCommit(session);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        onRenameCancel();
                      }
                    }}
                  />
                </form>
              ) : onSelect ? (
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
  onRename,
}: {
  session: SessionHistoryItem;
  onFork: (session: SessionHistoryItem) => void;
  onArchive?: (threadId: string) => void | Promise<void>;
  onRename?: () => void;
}) {
  const { t } = useTranslation();
  const title = session.title || session.threadId;
  return (
    <SessionActionsMenu title={title}>
      {onRename ? (
        <DropdownMenuItem onSelect={onRename}>
          <PencilSimple className="h-4 w-4" />
          {t("copilot.history.rename")}
        </DropdownMenuItem>
      ) : null}
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
