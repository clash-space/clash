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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CaretRight, Plus, Gear, PaperPlaneRight, ArrowClockwise, ChatsCircle } from '@phosphor-icons/react';
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

    const { crewId: handle } = parseMention(text);
    const target = handle ? resolveMention(handle) : null;

    // POST to room — server's mention dispatcher pushes a room.mention
    // frame back to the target crew's session, useGroupChat queues it,
    // and drainPending sends it to the daemon as a prompt. That is the
    // SINGLE dispatch path: don't also call sendToFocused here, or the
    // agent receives the same message twice (once raw, once prefixed
    // with "[room from human]"). The brief round-trip is worth the
    // single-source-of-truth.
    const mentions = target
      ? [{ user_id: userId, crew_member_id: target.id }]
      : [];
    await room.send(text, mentions);

    // Switch focus to the target crew so the user sees the reply
    // stream into the right tab.
    if (target) group.focus(target.id);
  }, [draft, userId, room, group, resolveMention]);

  // ─── @-mention autocomplete ───────────────────────────────────
  //
  // Detect when the cursor sits right after a fresh `@<query>` token
  // (no intervening space) — show a popover of invited crew filtered
  // by the partial handle. Picking inserts the full @<handle> + space
  // and dismisses. Arrow keys + Enter navigate; Escape dismisses.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIdx, setAcIdx] = useState(0);

  // Take the partial token immediately before the cursor that starts
  // with @ (no spaces in between). null if no live mention being
  // composed at the cursor.
  const partialMention = useCallback((): { query: string; start: number } | null => {
    const ta = textareaRef.current;
    if (!ta) return null;
    const pos = ta.selectionStart ?? 0;
    const before = draft.slice(0, pos);
    const m = before.match(/(?:^|\s)@([a-z0-9-]*)$/i);
    if (!m) return null;
    const start = pos - m[0].length + (m[0].startsWith('@') ? 0 : 1);
    return { query: m[1], start };
  }, [draft]);

  const acMatches = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    return invitedCrew.filter((c) => {
      const handle = c.display_name.toLowerCase().replace(/\s+/g, '-');
      return handle.startsWith(q) || c.template_id.startsWith(q);
    });
  }, [acOpen, acQuery, invitedCrew]);

  // Re-evaluate autocomplete state whenever the draft / cursor moves.
  // Run the regex against the EVENT VALUE directly, not partialMention()
  // — that helper reads `draft` from closure which is still the previous
  // value at this point (setDraft is async).
  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const pos = e.target.selectionStart ?? next.length;
    setDraft(next);
    const before = next.slice(0, pos);
    const m = before.match(/(?:^|\s)@([a-z0-9-]*)$/i);
    if (m) {
      setAcOpen(true);
      setAcQuery(m[1] ?? '');
      setAcIdx(0);
    } else {
      setAcOpen(false);
    }
  };

  const insertMention = useCallback((row: CrewRow) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const partial = partialMention();
    if (!partial) return;
    const handle = row.display_name.toLowerCase().replace(/\s+/g, '-');
    const before = draft.slice(0, partial.start);
    const after = draft.slice((ta.selectionStart ?? 0));
    const inserted = `@${handle} `;
    const next = before + inserted + after;
    setDraft(next);
    setAcOpen(false);
    // Move cursor to end of inserted mention on next paint.
    queueMicrotask(() => {
      const newPos = (before + inserted).length;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  }, [draft, partialMention]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (acOpen && acMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcIdx((i) => (i + 1) % acMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcIdx((i) => (i - 1 + acMatches.length) % acMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(acMatches[acIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAcOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (isCollapsed) {
    // Floating circular ball — brand-tinted, slightly inset from the
    // edge so it reads as "stuck to the page" not "sliced off the
    // panel". Hover lifts + shifts left to invite the click.
    return (
      <motion.button
        onClick={() => onCollapseChange(false)}
        className="fixed right-4 top-1/2 -translate-y-1/2 z-50 h-12 w-12 rounded-full bg-warm-surface/90 backdrop-blur-md shadow-xl hover:shadow-2xl flex items-center justify-center group"
        whileHover={{ scale: 1.08, x: -4 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        aria-label="Expand group chat"
        title="Open group chat"
      >
        <ChatsCircle className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" weight="duotone" />
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
      className="h-full bg-warm-surface/85 backdrop-blur-xl shadow-2xl flex flex-col relative rounded-matrix overflow-hidden"
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

      {/* Floating top-right: action balls + presence stack. Same
          motion-button pattern ChatbotCopilot used so the panel reads
          continuous with the rest of the surface. */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
        <motion.button
          onClick={() => void room.refetch()}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-2 rounded-full hover:bg-warm-muted text-slate-700 transition-colors"
          title="Refresh room"
        >
          <ArrowClockwise className="w-5 h-5" weight="bold" />
        </motion.button>
        <a
          href="/settings"
          className="p-2 rounded-full hover:bg-warm-muted text-slate-700 transition-colors flex items-center justify-center"
          title="Manage crew"
        >
          <Gear className="w-5 h-5" weight="bold" />
        </a>
        {otherClients.length > 0 && (
          <div className="ml-1.5">
            <PresenceBar clients={otherClients} />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 pt-16">
        {/* Tab pill row — single nav element. Each pill is a rounded-matrix
            chip with avatar + label; + at end opens the invite popover. */}
        <div className="px-4 pb-2 flex items-center gap-1.5 overflow-x-auto scrollbar-thin shrink-0">
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
        <div className="px-4 pb-4 pt-2 relative shrink-0">
          {/* @-mention autocomplete popover. Floats just above the input. */}
          <AnimatePresence>
            {acOpen && acMatches.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute left-4 right-4 bottom-full mb-2 z-30 bg-warm-surface/95 backdrop-blur-xl rounded-matrix shadow-xl overflow-hidden"
              >
                <div className="px-3 py-1.5 bg-warm-muted/60">
                  <div className="font-display text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Address crew</div>
                </div>
                {acMatches.map((c, idx) => {
                  const handle = c.display_name.toLowerCase().replace(/\s+/g, '-');
                  const initials = c.display_name.slice(0, 2).toUpperCase();
                  const offline = c.runtime_status !== 'online';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); insertMention(c); }}
                      onMouseEnter={() => setAcIdx(idx)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                        idx === acIdx ? 'bg-warm-muted' : 'hover:bg-warm-muted/60'
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-muted text-[10px] font-bold text-stone-700">{initials}</span>
                      <span className="flex-1 text-left">
                        <span className="font-medium text-stone-800">@{handle}</span>
                        <span className="text-stone-400 ml-1.5">{c.display_name}</span>
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-stone-300' : 'bg-emerald-500'}`} />
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-2 items-end bg-warm-muted/60 backdrop-blur-md rounded-matrix shadow-sm p-2 focus-within:bg-warm-muted/80 focus-within:shadow-md transition">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={onDraftChange}
              onKeyDown={handleKeyDown}
              onBlur={() => queueMicrotask(() => setAcOpen(false))}
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
