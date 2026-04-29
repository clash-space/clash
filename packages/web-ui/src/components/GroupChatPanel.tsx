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
import { CaretLeft, CaretRight, Plus, Users, Gear } from '@phosphor-icons/react';
import { useGroupChat, type ClaimedCrew } from '@clash/web-ui/hooks/useGroupChat';
import { useProjectRoom } from '@clash/web-ui/hooks/useProjectRoom';
import { AcpMessageList } from '@clash/web-ui/components/copilot/AcpMessageList';
import type { RoomMessageEvent } from '@clash/shared-types';
import { parseMention } from '../_group-chat/mention';

const ROOM_TAB = '__room__';

const invitedKey = (projectId: string) => `clash:invitedCrew:${projectId}`;

export interface GroupChatPanelProps {
  projectId: string;
  /** Current user id — used to label your own messages and stamp mentions. */
  userId: string;
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
      <button
        onClick={() => onCollapseChange(false)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-white border border-stone-200 border-r-0 rounded-l-lg p-2 shadow-sm hover:bg-stone-50"
        aria-label="Expand group chat"
      >
        <CaretLeft className="w-5 h-5 text-stone-600" weight="bold" />
      </button>
    );
  }

  const uninvitedClaimed = claimedCrew.filter((c) => !invitedIds.includes(c.id));
  const focusedCrew = group.crew.find((c) => c.crewId === activeTab);

  return (
    <div
      className="h-full bg-white border-l border-stone-200 flex flex-col"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-stone-600 flex-shrink-0" weight="bold" />
          <span className="text-sm font-medium text-stone-800">Group Chat</span>
        </div>
        <button
          onClick={() => onCollapseChange(true)}
          className="p-1 rounded hover:bg-stone-100 text-stone-500"
          aria-label="Collapse"
        >
          <CaretRight className="w-4 h-4" weight="bold" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Crew rail */}
        <div className="w-14 border-r border-stone-200 flex flex-col items-center py-2 gap-2 bg-stone-50/50">
          <div className="relative">
            <button
              onClick={() => setShowAddMenu((v) => !v)}
              className="w-9 h-9 rounded-full bg-white border border-stone-200 flex items-center justify-center hover:bg-stone-100 text-stone-600"
              title="Invite crew"
            >
              <Plus className="w-4 h-4" weight="bold" />
            </button>
            {showAddMenu && (
              <div className="absolute left-12 top-0 z-30 w-72 bg-white border border-stone-200 rounded-lg shadow-lg py-1">
                {crewLoading ? (
                  <div className="px-3 py-2 text-xs text-stone-400">Loading…</div>
                ) : claimedCrew.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-stone-500">
                    No crew claimed yet.{' '}
                    <a href="/settings" className="text-stone-700 underline inline-flex items-center gap-0.5">
                      Open Settings <Gear className="w-3 h-3" />
                    </a>
                  </div>
                ) : uninvitedClaimed.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-stone-400">All claimed crew already invited.</div>
                ) : (
                  uninvitedClaimed.map((c) => {
                    const offline = c.runtime_status !== 'online';
                    return (
                      <button
                        key={c.id}
                        onClick={() => invite(c)}
                        disabled={offline}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-50"
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
                  })
                )}
              </div>
            )}
          </div>

          {invitedCrew.map((c) => {
            const live = group.crew.find((x) => x.crewId === c.id);
            const isActive = activeTab === c.id;
            const dot = live?.status === 'streaming' || live?.status === 'sending'
              ? 'bg-amber-500'
              : live?.status === 'connected'
              ? 'bg-emerald-500'
              : live?.status === 'error' || live?.status === 'disconnected'
              ? 'bg-stone-400'
              : 'bg-stone-300';
            const initials = c.display_name.slice(0, 2).toUpperCase();
            return (
              <button
                key={c.id}
                onClick={() => {
                  setActiveTab(c.id);
                  group.focus(c.id);
                }}
                className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs font-semibold relative ${
                  isActive ? 'border-stone-700 bg-white' : 'border-stone-200 bg-white hover:bg-stone-100'
                }`}
                title={`${c.display_name}${live ? ` — ${live.status}` : ''}`}
              >
                <span className="text-stone-700">{initials}</span>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dot}`} />
                {live?.unread && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-white" />
                )}
              </button>
            );
          })}
        </div>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-stone-200 px-2 gap-1 overflow-x-auto">
            <TabButton
              label="Room"
              active={activeTab === ROOM_TAB}
              onClick={() => setActiveTab(ROOM_TAB)}
            />
            {invitedCrew.map((c) => {
              const live = group.crew.find((x) => x.crewId === c.id);
              return (
                <TabButton
                  key={c.id}
                  label={c.display_name}
                  active={activeTab === c.id}
                  onClick={() => {
                    setActiveTab(c.id);
                    group.focus(c.id);
                  }}
                  unread={!!live?.unread}
                  onClose={() => uninvite(c.id)}
                />
              );
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
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

          {/* Input */}
          <div className="border-t border-stone-200 p-2">
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  invitedCrew.length === 0
                    ? 'Invite a crew member with + to start chatting'
                    : `@${invitedCrew[0]?.display_name.toLowerCase().replace(/\s+/g, '-')} ... or just talk to the room (Enter to send)`
                }
                rows={2}
                className="flex-1 resize-none rounded border border-stone-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-stone-400 disabled:bg-stone-50 disabled:text-stone-400"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim()}
                className="self-end px-3 py-1.5 rounded bg-stone-800 text-white text-sm hover:bg-stone-700 disabled:bg-stone-300"
              >
                Send
              </button>
            </div>
            {room.error && <div className="text-xs text-red-600 mt-1">{room.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  unread,
  onClose,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  unread?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className={`flex items-center group ${active ? 'border-b-2 border-stone-700' : ''}`}>
      <button
        onClick={onClick}
        className={`px-3 py-1.5 text-sm relative ${
          active ? 'text-stone-900 font-medium' : 'text-stone-500 hover:text-stone-700'
        }`}
      >
        {label}
        {unread && !active && (
          <span className="absolute top-1 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
        )}
      </button>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-xs text-stone-300 hover:text-stone-600 px-1 opacity-0 group-hover:opacity-100"
          title="Remove from room"
        >
          ×
        </button>
      )}
    </div>
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
      <div className="text-center text-sm text-stone-400 py-8">
        {hasInvited
          ? <>Nothing in the room yet. Try <code className="px-1 rounded bg-stone-100">@&lt;name&gt;</code> to talk to a crew member.</>
          : <>Invite a crew member with the <span className="px-1 rounded bg-stone-100">+</span> button to start.</>
        }
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const isMe = m.sender_kind === 'user' && m.sender_user_id === userId;
        const sender =
          m.sender_kind === 'crew'
            ? labelFor(m.sender_id)
            : isMe
            ? 'You'
            : m.sender_id.slice(0, 8);
        return (
          <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[80%]">
              <div className={`text-xs text-stone-500 mb-0.5 ${isMe ? 'text-right' : ''}`}>{sender}</div>
              <div
                className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                  isMe
                    ? 'bg-stone-800 text-white'
                    : m.sender_kind === 'crew'
                    ? 'bg-amber-50 border border-amber-200 text-stone-800'
                    : 'bg-stone-100 text-stone-800'
                }`}
              >
                {m.text}
              </div>
            </div>
          </div>
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
