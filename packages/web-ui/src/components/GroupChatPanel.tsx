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
 * Sub-components live under `_group-chat/` (TabPill, RoomView, CrewView,
 * MentionAutocomplete, InviteCrewMenu). State machinery for the @-mention
 * autocomplete + cursor placement lives in
 * `hooks/useMentionAutocomplete`. This file is the shell that wires
 * them together.
 *
 * Old ChatbotCopilot is kept in the repo (no import). Restore by
 * swapping the JSX in ProjectEditor.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CaretRight, Gear, PaperPlaneRight, ArrowClockwise, ChatsCircle } from '@phosphor-icons/react';
import { useGroupChat } from '@clash/web-ui/hooks/useGroupChat';
import { useProjectRoom } from '@clash/web-ui/hooks/useProjectRoom';
import { useClaimedCrew } from '@clash/web-ui/hooks/useClaimedCrew';
import { useMentionAutocomplete } from '@clash/web-ui/hooks/useMentionAutocomplete';
import PresenceBar from '@clash/web-ui/components/PresenceBar';
import type { PresenceClient, RoomMessageEvent } from '@clash/shared-types';
import { parseMention } from '../_group-chat/mention';
import { crewHandle, type CrewRow } from '../_group-chat/panel-types';
import { loadInvited, saveInvited } from '../_group-chat/invitedStorage';
import { TabPill } from '../_group-chat/TabPill';
import { RoomView } from '../_group-chat/RoomView';
import { CrewView } from '../_group-chat/CrewView';
import { MentionAutocomplete } from '../_group-chat/MentionAutocomplete';
import { InviteCrewMenu } from '../_group-chat/InviteCrewMenu';

const ROOM_TAB = '__room__';

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const uninvite = useCallback(
    (id: string) => {
      setInvitedIds((prev) => prev.filter((x) => x !== id));
      group.removeCrew(id);
      setActiveTab((cur) => (cur === id ? ROOM_TAB : cur));
    },
    [group],
  );

  // Mention name resolution: try invited crew display_name first, then
  // fall back to template id (lets `@director` still work as a shortcut
  // when there's exactly one Director invited). Returns the matching
  // claim id (= crew_member.id) or null.
  const resolveMention = useCallback(
    (handle: string): CrewRow | null => {
      const lower = handle.toLowerCase();
      const byName = invitedCrew.find((c) => crewHandle(c.display_name) === lower);
      if (byName) return byName;
      const byTemplate = invitedCrew.filter((c) => c.template_id === lower);
      if (byTemplate.length === 1) return byTemplate[0]; // ambiguous → null
      return null;
    },
    [invitedCrew],
  );

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
    const mentions = target ? [{ user_id: userId, crew_member_id: target.id }] : [];
    await room.send(text, mentions);

    // Switch focus to the target crew so the user sees the reply
    // stream into the right tab.
    if (target) group.focus(target.id);
  }, [draft, userId, room, group, resolveMention]);

  // @-mention autocomplete state + keyboard handling, including the
  // rAF-based cursor placement fix.
  const ac = useMentionAutocomplete(draft, setDraft, textareaRef, invitedCrew);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac.onKeyDown(e)) return; // consumed by autocomplete
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
  const firstInvitedHandle = invitedCrew[0] && crewHandle(invitedCrew[0].display_name);

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

      {/* Floating top-right: action balls + presence stack. */}
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
        {/* Tab pill row */}
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
                status={live?.status}
                initials={c.display_name.slice(0, 2).toUpperCase()}
              />
            );
          })}

          <InviteCrewMenu
            open={showAddMenu}
            onToggle={() => setShowAddMenu((v) => !v)}
            uninvitedClaimed={uninvitedClaimed}
            totalClaimed={claimedCrew.length}
            loading={crewLoading}
            onInvite={invite}
          />
        </div>

        {/* Body */}
        <div className="flex-1 px-5 pt-2 pb-6 min-h-0">
          {activeTab === ROOM_TAB ? (
            <RoomView
              messages={room.messages}
              userId={userId}
              labelFor={(id) => claimById(id)?.display_name ?? id}
              empty={!room.loading && room.messages.length === 0}
              hasInvited={invitedCrew.length > 0}
            />
          ) : (
            <CrewView
              messages={focusedCrew?.messages ?? []}
              status={focusedCrew?.status}
              errorMessage={focusedCrew?.errorMessage}
              onRetry={focusedCrew ? () => group.retryCrew?.(focusedCrew.crewId) : undefined}
            />
          )}
        </div>

        {/* Input — frosted, rounded-matrix bubble */}
        <div className="px-4 pb-4 pt-2 relative shrink-0">
          <MentionAutocomplete
            open={ac.open}
            matches={ac.matches}
            activeIndex={ac.activeIndex}
            onHover={ac.setActiveIndex}
            onPick={ac.insertMention}
          />

          <div className="flex gap-2 items-end bg-warm-muted/60 backdrop-blur-md rounded-matrix shadow-sm p-2 focus-within:bg-warm-muted/80 focus-within:shadow-md transition">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={ac.onDraftChange}
              onKeyDown={handleKeyDown}
              onBlur={() => queueMicrotask(() => ac.close())}
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
