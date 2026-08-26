import { useState, type ReactNode } from "react";
import {
  Archive,
  ArrowBendDownRight,
  ArrowCounterClockwise,
  DotsThree,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tab, TabList, TabPanel, TabProvider } from "../ui/tabs";
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

export type SessionArchiveStatus = "idle" | "loading" | "ready" | "error";

type SessionHistorySidebarProps = {
  activeSessions: SessionHistoryItem[];
  archivedSessions: SessionHistoryItem[];
  activeSessionId?: string;
  archiveStatus?: SessionArchiveStatus;
  archiveError?: string | null;
  onSelect: (session: SessionHistoryItem) => void;
  onFork: (session: SessionHistoryItem) => void;
  onArchive?: (threadId: string) => void | Promise<void>;
  onRestore?: (threadId: string) => void | Promise<void>;
  onDeletePermanently?: (threadId: string) => void | Promise<void>;
  onLoadArchived?: () => void | Promise<void>;
  onClose: () => void;
  className?: string;
};

export function SessionHistorySidebar({
  activeSessions,
  archivedSessions,
  activeSessionId,
  archiveStatus = "idle",
  archiveError,
  onSelect,
  onFork,
  onArchive,
  onRestore,
  onDeletePermanently,
  onLoadArchived,
  onClose,
  className,
}: SessionHistorySidebarProps) {
  const { t } = useTranslation();
  const [selectedView, setSelectedView] = useState<"active" | "archived">(
    "active",
  );
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const selectView = (next: string | null | undefined) => {
    if (next !== "active" && next !== "archived") return;
    setSelectedView(next);
    setConfirmingDeleteId(null);
    if (next === "archived" && archiveStatus === "idle") {
      void onLoadArchived?.();
    }
  };

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

      <TabProvider
        selectedId={selectedView}
        setSelectedId={selectView}
        orientation="horizontal"
        focusLoop
      >
        <TabList
          aria-label={t("copilot.history.title")}
          className="mx-3 grid grid-cols-2 gap-1 rounded-lg bg-warm-muted p-1"
        >
          <HistoryTab id="active" label={t("copilot.history.active")} />
          <HistoryTab id="archived" label={t("copilot.history.archived")} />
        </TabList>

        <TabPanel
          tabId="active"
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
        </TabPanel>

        <TabPanel
          tabId="archived"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2 outline-none"
        >
          {archiveStatus === "loading" ? (
            <SessionListSkeleton />
          ) : archiveStatus === "error" ? (
            <div className="px-2 py-8 text-center text-xs text-content-secondary">
              <p>{archiveError || t("copilot.history.archiveLoadError")}</p>
              <button
                type="button"
                onClick={() => void onLoadArchived?.()}
                className="mt-3 rounded-md px-2 py-1 font-medium text-content-primary outline-none hover:bg-warm-hover focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {t("copilot.history.retry")}
              </button>
            </div>
          ) : (
            <SessionList
              sessions={archivedSessions}
              emptyLabel={t("copilot.history.archivedEmpty")}
              confirmingDeleteId={confirmingDeleteId}
              onCancelDelete={() => setConfirmingDeleteId(null)}
              onConfirmDelete={(threadId) => {
                setConfirmingDeleteId(null);
                void onDeletePermanently?.(threadId);
              }}
              actions={(session) => (
                <ArchivedSessionActions
                  session={session}
                  onRestore={onRestore}
                  onRequestDelete={setConfirmingDeleteId}
                />
              )}
            />
          )}
        </TabPanel>
      </TabProvider>
    </aside>
  );
}

function HistoryTab({ id, label }: { id: string; label: string }) {
  return (
    <Tab
      id={id}
      className="h-7 rounded-md px-2 text-xs font-medium text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-ring/50 aria-selected:bg-warm-surface aria-selected:text-content-primary aria-selected:shadow-sm"
    >
      {label}
    </Tab>
  );
}

function SessionList({
  sessions,
  activeSessionId,
  emptyLabel,
  onSelect,
  actions,
  confirmingDeleteId,
  onCancelDelete,
  onConfirmDelete,
}: {
  sessions: SessionHistoryItem[];
  activeSessionId?: string;
  emptyLabel: string;
  onSelect?: (session: SessionHistoryItem) => void;
  actions: (session: SessionHistoryItem) => ReactNode;
  confirmingDeleteId?: string | null;
  onCancelDelete?: () => void;
  onConfirmDelete?: (threadId: string) => void;
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
        const confirmingDelete = confirmingDeleteId === session.threadId;
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
            {confirmingDelete ? (
              <div className="mx-1.5 mb-1 flex items-center gap-1 rounded-lg bg-warm-muted px-2 py-1.5 text-[11px] text-content-secondary">
                <span className="min-w-0 flex-1">
                  {t("copilot.history.deleteConfirm")}
                </span>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="rounded-md px-1.5 py-1 font-medium text-content-secondary outline-none hover:bg-warm-hover hover:text-content-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {t("copilot.history.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmDelete?.(session.threadId)}
                  className="rounded-md px-1.5 py-1 font-medium text-red-600 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500/50 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  {t("copilot.history.confirmDelete")}
                </button>
              </div>
            ) : null}
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

function ArchivedSessionActions({
  session,
  onRestore,
  onRequestDelete,
}: {
  session: SessionHistoryItem;
  onRestore?: (threadId: string) => void | Promise<void>;
  onRequestDelete: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const title = session.title || session.threadId;
  return (
    <SessionActionsMenu title={title}>
      <DropdownMenuItem onSelect={() => void onRestore?.(session.threadId)}>
        <ArrowCounterClockwise className="h-4 w-4" />
        {t("copilot.history.restore")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => onRequestDelete(session.threadId)}
        className="text-red-600 focus:text-red-700 dark:text-red-300"
      >
        <Trash className="h-4 w-4" />
        {t("copilot.history.deletePermanently")}
      </DropdownMenuItem>
    </SessionActionsMenu>
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

function SessionListSkeleton() {
  return (
    <div
      aria-label="Loading archived sessions"
      role="status"
      className="space-y-2 px-2 py-2"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-12 animate-pulse rounded-lg bg-warm-muted"
        />
      ))}
    </div>
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
