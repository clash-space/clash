/**
 * GroupChatPanel — group chat panel built on the claim layer.
 *
 * Identity model:
 *   - Templates (Director / Canvas Editor / …) live in the bridge as
 *     read-only role definitions.
 *   - User claims them in Settings → produces crew_member rows.
 *   - This panel works on **claimed crew**: the + dropdown shows the
 *     user's claimed crew (via /api/v1/crew); each claim is bound to a
 *     specific runtime, so there's no panel-wide runtime picker.
 *   - Per-project, the user "invites" claimed crew into the room;
 *     invitations persist in localStorage (keyed by project_id) so
 *     refreshing the page doesn't re-empty the rail.
 *
 * Three views, switched via top tabs:
 *   - Room       (default): the project-wide IM log. Humans typing +
 *                future crew broadcasts (via say_to_room) land here.
 *   - <Crew>     One per invited crew. Shows that crew's full event
 *                stream (tool calls, streamed text, etc.).
 *
 * Input parses leading `@<displayname>` (matched against invited crew's
 * display name; falls back to template id for back-compat). Mention
 * encodes crew_member_id in the room message; server's mention
 * dispatcher uses that to find the right runtime_session and push a
 * room.mention frame to the crew's react loop (which queues it as
 * next-turn prompt — append-on-next-turn semantics).
 *
 * Old ChatbotCopilot is kept in the repo (no import). Restore by
 * swapping the JSX in ProjectEditor.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretLeft, CaretRight, Plus, Gear, PaperPlaneRight } from '@phosphor-icons/react';
import { useGroupChat, type ClaimedCrew } from '@clash/web-ui/hooks/useGroupChat';
import { useProjectRoom } from '@clash/web-ui/hooks/useProjectRoom';
import { AcpMessageList } from '@clash/web-ui/components/copilot/AcpMessageList';
import PresenceBar from '@clash/web-ui/components/PresenceBar';
import type { PresenceClient, RoomMessageEvent } from '@clash/shared-types';
import { parseMention } from '../_group-chat/mention';

const ROOM_TAB = '__room__';

const invitedKey = (projectId: string) => `clash:invitedCrew:${projectId}`;

export interface GroupChatPanelProps {
  projectId: string;
  /** Current user id — used to label your own messages and stamp mentions. */
  userId: string;
  /**
   * Browser / cli / agent clients currently attached to this project's
   * ProjectRoom DO. Surfaces "who's also looking at this room" as a
   * stack of avatars next to the collapse control.
   */
  presenceClients: PresenceClient[];
  width: number;
  onWidthChange: (w: number) => void;
  isCollapsed: boolean;
  onCollapseChange: (c: boolean) => void;
  /**
   * Bridge from useLoroSync's onRoomMessage to the room hook. The
   * caller wires this in to keep useLoroSync as the single live channel.
   */
  registerRoomSink?: (sink: (msg: RoomMessageEvent) => void) => void;
}

interface CrewRow {
  id: string;
  template_id: string;
  runtime_id: string;
  display_name: string;
  runtime_label: string | null;
  runtime_status: string | null;
}

function useClaimedCrew(): {
  crew: CrewRow[];
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/crew', { credentials: 'same-origin' });
      if (!res.ok) return;
      const json = (await res.json()) as { crew: CrewRow[] };
      setCrew(json.crew ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { crew, loading, refetch };
}

function loadInvited(projectId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(invitedKey(projectId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveInvited(projectId: string, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(invitedKey(projectId), JSON.stringify(ids));
  } catch {
    // Quota / disabled — ignore; UI just won't persist.
  }
}

export function GroupChatPanel({
  projectId,
  userId,
  presenceClients,
  width,
  isCollapsed,
  onCollapseChange,
  registerRoomSink,
}: GroupChatPanelProps) {
  const room = useProjectRoom(projectId);
  const group = useGroupChat(projectId);
  const { crew: claimedCrew, loading: crewLoading } = useClaimedCrew();
  const [invitedIds, setInvitedIds] = useState<string[]>(() => loadInvited(projectId));
  const [activeTab, setActiveTab] = useState<string>(ROOM_TAB);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [draft, setDraft] = useState('');

  // Refresh invited list on project change (refresh, navigation).
  useEffect(() => {
    setInvitedIds(loadInvited(projectId));
  }, [projectId]);

  // Persist invited list whenever it changes.
  useEffect(() => {
    saveInvited(projectId, invitedIds);
  }, [projectId, invitedIds]);

  // Wire room.message frames from the parent's useLoroSync subscription.
  useMemo(() => {
    registerRoomSink?.(room.setLiveMessage);
  }, [registerRoomSink, room.setLiveMessage]);

  const claimById = useCallback((id: string) => claimedCrew.find((c) => c.id === id), [claimedCrew]);
  const invitedCrew = useMemo(
    () => invitedIds.map(claimById).filter((c): c is CrewRow => !!c),
    [invitedIds, claimById],
  );

  // Auto-spawn sessions for invited crew that don't have one yet.
  // Runs whenever invited list or claimed crew changes.
  useEffect(() => {
    for (const c of invitedCrew) {
      const exists = group.crew.some((x) => x.crewId === c.id);
      if (!exists) {
        void group.addCrew({
          id: c.id,
          template_id: c.template_id,
          runtime_id: c.runtime_id,
          display_name: c.display_name,
        });
      }
    }
  }, [invitedCrew, group]);

  const invite = useCallback((row: CrewRow) => {
    setInvitedIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
    setShowAddMenu(false);
    setActiveTab(row.id);
  }, []);

  const uninvite = useCallback((id: string) => {
    setInvitedIds((prev) => prev.filter((x) => x !== id));
    group.removeCrew(id);
    setActiveTab((cur) => (cur === id ? ROOM_TAB : cur));
  }, [group]);

  // Mention name resolution: try invited crew display_name first, then
  // fall back to template id (lets `@director` still work as a shortcut
  // when there's exactly one Director invited). Returns the matching
  // claim id (= crew_member.id) or null.
  const resolveMention = useCallback((handle: string): CrewRow | null => {
    const lower = handle.toLowerCase();
    const byName = invitedCrew.find((c) =>
      c.display_name.toLowerCase().replace(/\s+/g, '-') === lower,
    );
    if (byName) return byName;
    const byTemplate = invitedCrew.filter((c) => c.template_id === lower);
    if (byTemplate.length === 1) return byTemplate[0]; // ambiguous → null
    return null;
  }, [invitedCrew]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');

    const { crewId: handle, body: cleanText } = parseMention(text);
    const target = handle ? resolveMention(handle) : null;

    // Post to room (always — it's the durable record).
    const mentions = target
      ? [{ user_id: userId, crew_member_id: target.id }]
      : [];
    await room.send(text, mentions);

    // If we mentioned someone, dispatch the cleaned text directly to
    // their session so they actually respond. (Server-side room.mention
    // forwarding handles the case where the crew is in the room but
    // not yet attached on this browser; that's the next-turn-append
    // path. Here we do the immediate-prompt path for the focused user.)
    if (target) {
      group.focus(target.id);
      queueMicrotask(() => group.sendToFocused(cleanText));
    }
  }, [draft, userId, room, group, resolveMention]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (isCollapsed) {
    return (
      <motion.button
        onClick={() => onCollapseChange(false)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-warm-surface/90 backdrop-blur-md rounded-l-matrix p-2.5 shadow-lg hover:bg-warm-muted"
        whileHover={{ scale: 1.05, x: -2 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Expand group chat"
      >
        <CaretLeft className="w-5 h-5 text-stone-600" weight="bold" />
      </motion.button>
    );
  }

  const uninvitedClaimed = claimedCrew.filter((c) => !invitedIds.includes(c.id));
  const focusedCrew = group.crew.find((c) => c.crewId === activeTab);
  const firstInvitedHandle = invitedCrew[0]?.display_name.toLowerCase().replace(/\s+/g, '-');

  // "Other clients" — humans / cli / agents connected to this project's
  // ProjectRoom besides the local user. Mirrors the canvas presence
  // filter (ProjectEditor.tsx:315) so the same set of dots shows up
  // here and on the canvas, never inflated by your own session.
  const otherClients = presenceClients.filter((c) => c.userId !== userId);

  return (
    <div
      className="h-full bg-warm-surface/85 backdrop-blur-xl shadow-2xl flex flex-col relative"
      style={{ width }}
    >
      {/* Floating top-left: collapse */}
      <motion.button
        onClick={() => onCollapseChange(true)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="absolute left-2 top-4 z-20 p-2 flex items-center justify-center hover:bg-warm-muted rounded-full transition-all"
        aria-label="Collapse"
      >
        <CaretRight className="w-5 h-5 text-stone-600" weight="bold" />
      </motion.button>

      {/* Floating top-right: presence stack (humans + agents in this room) */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <PresenceBar clients={otherClients} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 pt-16">
        {/* Tab pill row — single nav element. Each pill is a rounded-matrix
            chip with avatar + label; + at end opens the invite popover. */}
        <div className="px-4 pb-2 flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
          <TabPill
            label="Room"
            active={activeTab === ROOM_TAB}
            onClick={() => setActiveTab(ROOM_TAB)}
            kind="room"
          />
          {invitedCrew.map((c) => {
            const live = group.crew.find((x) => x.crewId === c.id);
            return (
              <TabPill
                key={c.id}
                label={c.display_name}
                active={activeTab === c.id}
                onClick={() => {
                  setActiveTab(c.id);
                  group.focus(c.id);
                }}
                onClose={() => uninvite(c.id)}
                unread={!!live?.unread}
                pendingCount={live?.pendingPrompts.length ?? 0}
                statusDot={statusToDot(live?.status)}
                initials={c.display_name.slice(0, 2).toUpperCase()}
              />
            );
          })}

          {/* Invite-crew + button + popover */}
          <div className="relative shrink-0">
            <motion.button
              onClick={() => setShowAddMenu((v) => !v)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="h-8 w-8 rounded-matrix bg-warm-muted/70 backdrop-blur-sm hover:bg-warm-muted hover:text-brand text-stone-500 flex items-center justify-center transition-colors"
              title="Invite crew"
            >
              <Plus className="w-3.5 h-3.5" weight="bold" />
            </motion.button>
            <AnimatePresence>
              {showAddMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  className="absolute right-0 top-10 z-30 w-72 bg-warm-surface/95 backdrop-blur-xl rounded-matrix shadow-xl border border-warm-border overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-warm-border bg-warm-muted/60">
                    <div className="font-display text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Invite crew</div>
                  </div>
                  {crewLoading ? (
                    <div className="px-3 py-3 text-xs text-stone-400">Loading…</div>
                  ) : claimedCrew.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-stone-500 leading-relaxed">
                      No crew claimed yet.{' '}
                      <a href="/settings" className="text-brand hover:text-brand/80 underline inline-flex items-center gap-0.5">
                        Open Settings <Gear className="w-3 h-3" />
                      </a>
                    </div>
                  ) : uninvitedClaimed.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-stone-400">All claimed crew already invited.</div>
                  ) : (
                    <div className="py-1">
                      {uninvitedClaimed.map((c) => {
                        const offline = c.runtime_status !== 'online';
                        return (
                          <button
                            key={c.id}
                            onClick={() => invite(c)}
                            disabled={offline}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-warm-muted disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                            title={offline ? 'Runtime offline' : ''}
                          >
                            <div className="font-medium text-stone-800 flex items-center gap-1.5">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${offline ? 'bg-stone-300' : 'bg-emerald-500'}`} />
                              {c.display_name}
                            </div>
                            <div className="text-stone-500 mt-0.5">
                              {c.template_id} · {c.runtime_label || c.runtime_id.slice(0, 8)}
                              {offline && ' · offline'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6">
          {activeTab === ROOM_TAB ? (
            <RoomView
              messages={room.messages}
              userId={userId}
              labelFor={(id) => claimById(id)?.display_name ?? id}
              empty={!room.loading && room.messages.length === 0}
              hasInvited={invitedCrew.length > 0}
            />
          ) : (
            <CrewView messages={focusedCrew?.messages ?? []} />
          )}
        </div>

        {/* Input — frosted, rounded-matrix bubble */}
        <div className="px-4 pb-4 pt-2">
          <div className="flex gap-2 items-end bg-warm-muted/60 backdrop-blur-md rounded-matrix shadow-sm p-2 focus-within:bg-warm-muted/80 focus-within:shadow-md transition">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                invitedCrew.length === 0
                  ? 'Invite a crew member with + to start chatting'
                  : `Chat the room, or @${firstInvitedHandle} a crew member`
              }
              rows={2}
              className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none"
            />
              <motion.button
                onClick={() => void send()}
                disabled={!draft.trim()}
                whileHover={{ scale: draft.trim() ? 1.05 : 1 }}
                whileTap={{ scale: draft.trim() ? 0.95 : 1 }}
                className="self-end h-9 w-9 rounded-full bg-gradient-to-br from-brand to-red-500 text-white flex items-center justify-center shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send"
              >
                <PaperPlaneRight className="w-4 h-4" weight="fill" />
              </motion.button>
            </div>
          {room.error && <div className="text-xs text-brand mt-1.5 px-1">{room.error}</div>}
        </div>
      </div>
    </div>
  );
}

function statusToDot(status: string | undefined): string {
  if (status === 'streaming' || status === 'sending') return 'bg-amber-500';
  if (status === 'connected') return 'bg-emerald-500';
  if (status === 'error' || status === 'disconnected') return 'bg-stone-400';
  return 'bg-stone-300';
}

/**
 * Pill-shaped chip used for the tab row. Active = filled red→pink
 * gradient; inactive = frosted warm-surface with a subtle border.
 * Crew pills carry an avatar (initials) with status pip + unread /
 * pending-prompts indicators; Room pill is plain text.
 */
function TabPill({
  label,
  active,
  onClick,
  onClose,
  unread,
  pendingCount,
  statusDot,
  initials,
  kind = 'crew',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  unread?: boolean;
  pendingCount?: number;
  statusDot?: string;
  initials?: string;
  kind?: 'room' | 'crew';
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="shrink-0"
    >
      <button
        onClick={onClick}
        className={`group relative flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-matrix text-xs font-medium transition-all ${
          active
            ? 'bg-gradient-to-br from-brand to-red-500 text-white shadow-md'
            : 'bg-warm-muted/70 backdrop-blur-sm text-stone-700 hover:bg-warm-muted hover:text-stone-900'
        }`}
      >
        {kind === 'room' ? (
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            active ? 'bg-white/25 text-white' : 'bg-warm-surface/80 text-stone-500'
          }`}>#</span>
        ) : (
          <span className="relative">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
              active ? 'bg-white/25 text-white' : 'bg-warm-surface/80 text-stone-700'
            }`}>{initials}</span>
            {statusDot && (
              <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${statusDot}`} />
            )}
          </span>
        )}
        <span>{label}</span>
        {unread && !active && (
          <span className="w-1.5 h-1.5 rounded-full bg-brand" />
        )}
        {pendingCount && pendingCount > 0 ? (
          <span className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
            active ? 'bg-white/30 text-white' : 'bg-amber-500 text-white'
          }`}>
            {pendingCount}
          </span>
        ) : null}
        {onClose && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={`ml-0.5 text-[14px] leading-none opacity-0 group-hover:opacity-100 transition-opacity ${
              active ? 'text-white/80 hover:text-white' : 'text-stone-400 hover:text-brand'
            }`}
            title="Remove from room"
          >
            ×
          </span>
        )}
      </button>
    </motion.div>
  );
}

function RoomView({
  messages,
  userId,
  labelFor,
  empty,
  hasInvited,
}: {
  messages: RoomMessageEvent[];
  userId: string;
  labelFor: (id: string) => string;
  empty: boolean;
  hasInvited: boolean;
}) {
  if (empty) {
    return (
      <div className="text-center text-sm text-stone-400 py-12">
        {hasInvited
          ? <>Nothing in the room yet. Try <code className="px-1.5 py-0.5 rounded bg-brand-light text-brand font-mono">@&lt;name&gt;</code> to address a crew member.</>
          : <>Invite a crew member with the <span className="px-1.5 py-0.5 rounded bg-warm-muted">+</span> button to start.</>
        }
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {messages.map((m) => {
        const isMe = m.sender_kind === 'user' && m.sender_user_id === userId;
        const sender =
          m.sender_kind === 'crew'
            ? labelFor(m.sender_id)
            : isMe
            ? 'You'
            : m.sender_id.slice(0, 8);
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[82%]">
              <div className={`text-[11px] text-stone-500 mb-1 px-1 ${isMe ? 'text-right' : ''}`}>{sender}</div>
              <div
                className={`px-4 py-2.5 rounded-matrix text-sm whitespace-pre-wrap break-words shadow-sm ${
                  isMe
                    ? 'bg-gradient-to-br from-brand to-red-500 text-white'
                    : m.sender_kind === 'crew'
                    ? 'bg-amber-50/90 text-stone-800'
                    : 'bg-warm-muted/80 text-stone-800'
                }`}
              >
                {m.text}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// Per-crew tab uses the same renderer as the old single-agent panel
// so tool calls, streamed text, and unknown events all show the same
// way users are used to.
function CrewView({ messages }: { messages: import('@clash/web-ui/lib/acpEvents').ByoMessage[] }) {
  return (
    <div className="space-y-3">
      <AcpMessageList
        messages={messages}
        emptyHint="No messages yet for this crew. @-mention them in the Room to get them going."
      />
    </div>
  );
}
