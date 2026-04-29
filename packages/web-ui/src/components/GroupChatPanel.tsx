/**
 * GroupChatPanel — multi-crew group chat replacing the per-chat
 * ChatbotCopilot single-agent panel.
 *
 * Three views, switched via top tabs:
 *   - Room       (default): the project-wide IM log. Humans typing +
 *                future crew broadcasts (via say_to_room) land here.
 *   - <Crew>     One per spawned crew. Shows that crew's full event
 *                stream (tool calls, streamed text, etc.) — same data
 *                as the old single-session panel, just per-member.
 *
 * Crew rail (left) lists every spawned crew with status + unread dot;
 * + opens a dropdown of bundled crew the user can pull into the room
 * (which spawns their session). Clicking a crew row focuses its tab.
 *
 * Input parses leading `@<crewid>` — if present, posts to room with
 * mentions=[{crew_id, user_id: self}] AND auto-spawns the crew if it
 * isn't in the room yet. Without @, posts to room as a plain user
 * message. Crew responses (until say_to_room ships) only show in their
 * own crew tab — not in the room — by design.
 *
 * Live room messages arrive via the parent's useLoroSync `onRoomMessage`
 * callback — same WS as Loro CRDT. History fetch on mount.
 *
 * Old ChatbotCopilot is kept in the repo (no import). Restore by
 * swapping the JSX in ProjectEditor.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Plus, Users } from '@phosphor-icons/react';
import { useGroupChat } from '@clash/web-ui/hooks/useGroupChat';
import { useProjectRoom } from '@clash/web-ui/hooks/useProjectRoom';
import type { CrewMember } from '@clash/web-ui/components/copilot/SessionStartPicker';
import type { ByoMessage } from '@clash/web-ui/lib/acpEvents';
import type { RoomMessageEvent } from '@clash/shared-types';
import { parseMention } from '../_group-chat/mention';

const BUILTIN_CREW: CrewMember[] = [
  { id: 'director',        label: 'Director',          summary: 'Plans the video and orchestrates the other roles.' },
  { id: 'canvas-editor',   label: 'Canvas Editor',     summary: 'Adds / edits / reorders / deletes nodes on the canvas.' },
  { id: 'generator',       label: 'Generator',         summary: 'Dispatches and tracks image / video / clip generation.' },
  { id: 'storyboard',      label: 'Storyboard Artist', summary: 'Sketches a shot list and lays it on the canvas.' },
  { id: 'project-manager', label: 'Project Manager',   summary: 'Lists / creates / switches / deletes projects.' },
];

const ROOM_TAB = '__room__';

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

interface RuntimeListItem {
  id: string;
  label: string;
  status: string;
}

function useFirstOnlineRuntime(): { runtimeId: string | null; runtimeLabel: string | null; runtimes: RuntimeListItem[] } {
  const [list, setList] = useState<RuntimeListItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/runtimes', { credentials: 'same-origin' });
        if (!res.ok) return;
        const json = (await res.json()) as { runtimes?: RuntimeListItem[] };
        if (!cancelled) setList(json.runtimes ?? []);
      } catch {
        // Ignore — UI will show "no runtime"
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const online = list.find((r) => r.status === 'online');
  return {
    runtimeId: online?.id ?? null,
    runtimeLabel: online?.label ?? null,
    runtimes: list,
  };
}

export function GroupChatPanel({
  projectId,
  userId,
  width,
  isCollapsed,
  onCollapseChange,
  registerRoomSink,
}: GroupChatPanelProps) {
  const { runtimeId, runtimeLabel } = useFirstOnlineRuntime();
  const room = useProjectRoom(projectId);
  const group = useGroupChat(runtimeId, projectId);
  const [activeTab, setActiveTab] = useState<string>(ROOM_TAB);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [draft, setDraft] = useState('');

  // Wire our setLiveMessage into the parent's useLoroSync subscription.
  // useEffect-style register-once: parent stores the ref and forwards
  // every onRoomMessage frame here.
  useMemo(() => {
    registerRoomSink?.(room.setLiveMessage);
  }, [registerRoomSink, room.setLiveMessage]);

  const labelFor = useCallback((id: string) => {
    return BUILTIN_CREW.find((c) => c.id === id)?.label ?? id;
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !runtimeId) return;
    setDraft('');

    const { crewId: targetCrewId, body: cleanText } = parseMention(text);

    // Auto-spawn the mentioned crew if it isn't in the room yet.
    if (targetCrewId) {
      const exists = group.crew.some((c) => c.crewId === targetCrewId);
      if (!exists) await group.addCrew(targetCrewId);
    }

    // Post to the room — this is the durable record. Server will
    // broadcast back via the WS sideband; we don't optimistically insert.
    const mentions = targetCrewId
      ? [{ user_id: userId, crew_id: targetCrewId }]
      : [];
    await room.send(text, mentions);

    // Dispatch the cleaned text to the mentioned crew's session so it
    // actually responds. (Without this, the message lives in the room
    // but no crew acts on it — equivalent to talking to nobody.)
    if (targetCrewId) {
      // group.sendToFocused requires focus first; switch then send.
      group.focus(targetCrewId);
      // sendToFocused reads focusedCrewId from the hook's state; allow
      // a microtask for the focus state to settle, then send.
      queueMicrotask(() => group.sendToFocused(cleanText));
    }
  }, [draft, runtimeId, userId, room, group]);

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
          {runtimeLabel && (
            <span className="text-xs text-stone-500 truncate">· on {runtimeLabel}</span>
          )}
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
              title="Add crew"
            >
              <Plus className="w-4 h-4" weight="bold" />
            </button>
            {showAddMenu && (
              <div className="absolute left-12 top-0 z-30 w-56 bg-white border border-stone-200 rounded-lg shadow-lg py-1">
                {BUILTIN_CREW.filter((c) => !group.crew.some((x) => x.crewId === c.id)).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      void group.addCrew(c.id);
                      setShowAddMenu(false);
                      setActiveTab(c.id);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50"
                  >
                    <div className="font-medium text-stone-800">{c.label}</div>
                    {c.summary && (
                      <div className="text-stone-500 mt-0.5 line-clamp-2">{c.summary}</div>
                    )}
                  </button>
                ))}
                {group.crew.length === BUILTIN_CREW.length && (
                  <div className="px-3 py-1.5 text-xs text-stone-400">All crew added</div>
                )}
              </div>
            )}
          </div>

          {group.crew.map((c) => {
            const isActive = activeTab === c.crewId;
            const dot = c.status === 'streaming' || c.status === 'sending'
              ? 'bg-amber-500'
              : c.status === 'connected'
              ? 'bg-emerald-500'
              : c.status === 'error' || c.status === 'disconnected'
              ? 'bg-stone-400'
              : 'bg-stone-300';
            const initials = labelFor(c.crewId).slice(0, 2).toUpperCase();
            return (
              <button
                key={c.crewId}
                onClick={() => {
                  setActiveTab(c.crewId);
                  group.focus(c.crewId);
                }}
                className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs font-semibold relative ${
                  isActive ? 'border-stone-700 bg-white' : 'border-stone-200 bg-white hover:bg-stone-100'
                }`}
                title={`${labelFor(c.crewId)} — ${c.status}`}
              >
                <span className="text-stone-700">{initials}</span>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dot}`} />
                {c.unread && (
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
            {group.crew.map((c) => (
              <TabButton
                key={c.crewId}
                label={labelFor(c.crewId)}
                active={activeTab === c.crewId}
                onClick={() => {
                  setActiveTab(c.crewId);
                  group.focus(c.crewId);
                }}
                unread={c.unread}
              />
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {activeTab === ROOM_TAB ? (
              <RoomView
                messages={room.messages}
                userId={userId}
                labelFor={labelFor}
                empty={!room.loading && room.messages.length === 0}
              />
            ) : (
              <CrewView
                messages={group.crew.find((c) => c.crewId === activeTab)?.messages ?? []}
              />
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
                  runtimeId
                    ? '@director ... or just talk to the room (Enter to send, Shift+Enter for newline)'
                    : 'Pick a runtime first'
                }
                disabled={!runtimeId}
                rows={2}
                className="flex-1 resize-none rounded border border-stone-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-stone-400 disabled:bg-stone-50 disabled:text-stone-400"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || !runtimeId}
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  unread?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm relative ${
        active
          ? 'border-b-2 border-stone-700 text-stone-900 font-medium'
          : 'text-stone-500 hover:text-stone-700'
      }`}
    >
      {label}
      {unread && !active && (
        <span className="absolute top-1 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
    </button>
  );
}

function RoomView({
  messages,
  userId,
  labelFor,
  empty,
}: {
  messages: RoomMessageEvent[];
  userId: string;
  labelFor: (id: string) => string;
  empty: boolean;
}) {
  if (empty) {
    return (
      <div className="text-center text-sm text-stone-400 py-8">
        Nothing in the room yet. Try <code className="px-1 rounded bg-stone-100">@director</code> to pull a crew in.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const isMe = m.sender_kind === 'user' && m.sender_user_id === userId;
        const sender =
          m.sender_kind === 'crew'
            ? `${labelFor(m.sender_id)}${m.sender_user_id !== userId ? ` (${m.sender_user_id.slice(0, 8)})` : ''}`
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

function CrewView({ messages }: { messages: ByoMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="text-center text-sm text-stone-400 py-8">
        No messages yet for this crew. @-mention them in the Room to get them going.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const text = msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
        if (!text) return null;
        return (
          <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                isUser ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-800'
              }`}
            >
              {text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
