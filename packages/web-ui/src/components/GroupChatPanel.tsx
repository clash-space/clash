/**
 * GroupChatPanel — group chat panel built on the claim layer.
 *
 * Identity model:
 *   - Agent templates live in the bridge as read-only runtime definitions.
 *   - User claims them in Settings → produces agent_member rows.
 *   - This panel works on **claimed agent**: the + dropdown shows the
 *     user's claimed agent (via /api/v1/agents); each claim is bound to a
 *     specific runtime, so there's no panel-wide runtime picker.
 *   - Per-project, the user "invites" claimed agent into the room;
 *     invitations persist in localStorage (keyed by project_id) so
 *     refreshing the page doesn't re-empty the rail.
 *
 * Three views, switched via top tabs:
 *   - Room       (default): the project-wide IM log. Humans typing +
 *                future agent broadcasts (via say_to_room) land here.
 *   - <Agent>     One per invited agent. Shows that agent's full event
 *                stream (tool calls, streamed text, etc.).
 *
 * Input parses leading `@<displayname>` (matched against invited agent's
 * display name; falls back to template id for back-compat). Mention
 * encodes agent_member_id in the room message; server's mention
 * dispatcher uses that to find the right runtime_session and push a
 * room.mention frame to the agent's react loop (which queues it as
 * next-turn prompt — append-on-next-turn semantics).
 *
 * Sub-components live under `_group-chat/` (TabPill, RoomView, AgentView,
 * MentionAutocomplete, InviteAgentMenu). State machinery for the @-mention
 * autocomplete + cursor placement lives in
 * `hooks/useMentionAutocomplete`. This file is the shell that wires
 * them together.
 *
 * Old ChatbotCopilot is kept in the repo (no import). Restore by
 * swapping the JSX in ProjectEditor.tsx.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CaretLeft, CaretRight, ArrowClockwise, Lightning } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router';
import { TabList, TabPanel, TabProvider } from '@ariakit/react';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { useBillingBalance } from '@clash/web-ui/hooks/useBillingBalance';
import { ChatInput, type UploadedAttachment } from './copilot/ChatInput';
import type { MentionableNode } from './MilkdownEditor';
import { useGroupChat, type GroupChatSessionEvent } from '@clash/web-ui/hooks/useGroupChat';
import { useProjectRoom, type RoomSyncMeta } from '@clash/web-ui/hooks/useProjectRoom';
import { useClaimedAgents } from '@clash/web-ui/hooks/useClaimedAgents';
import { useMentionAutocomplete } from '@clash/web-ui/hooks/useMentionAutocomplete';
import PresenceBar from '@clash/web-ui/components/PresenceBar';
import { visiblePresenceClients } from '@clash/web-ui/lib/presenceVisibility';
import type { PresenceClient, RoomMessageEvent } from '@clash/shared-types';
import { parseMention } from '../_group-chat/mention';
import { agentHandle, agentInitials, type AgentRow } from '../_group-chat/panel-types';
import { loadInvited, saveInvited } from '../_group-chat/invitedStorage';
import { TabPill } from '../_group-chat/TabPill';
import { RoomView } from '../_group-chat/RoomView';
import { AgentView } from '../_group-chat/AgentView';
import { MentionAutocomplete } from '../_group-chat/MentionAutocomplete';
import { InviteAgentMenu } from '../_group-chat/InviteAgentMenu';
import { statusDotClass, statusDotLabel } from '../_group-chat/statusDot';

const ROOM_TAB = '__room__';

/**
 * Visual footprint added by the rail that floats on the left of the
 * chat panel. ProjectEditor uses this to leave room for the rail when
 * computing where the canvas content's right edge is. Keep in sync
 * with the rail's actual width + gap below.
 */
export const CHAT_PANEL_RAIL_WIDTH = 56; // 48px column + 8px gap

const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 720;

function roomSyncIndicator(sync: RoomSyncMeta | null | undefined): {
  label: string;
  title: string;
  dotClass: string;
  textClass: string;
} {
  if (sync?.remote_room.status === 'failed') {
    return {
      label: 'Sync issue',
      title: 'Cloud room sync failed',
      dotClass: 'bg-red-500',
      textClass: 'text-red-700 dark:text-red-300',
    };
  }
  if (!sync?.remote_room.enabled) {
    return {
      label: 'Local',
      title: 'Room messages are local to this desktop',
      dotClass: 'bg-stone-300 dark:bg-stone-500',
      textClass: 'text-stone-500 dark:text-stone-400',
    };
  }
  if (sync.remote_room.status === 'mirrored' || sync.remote_room.status === 'imported') {
    return {
      label: 'Synced',
      title: 'Cloud room sync is up to date',
      dotClass: 'bg-emerald-500 dark:bg-emerald-400',
      textClass: 'text-emerald-700 dark:text-emerald-300',
    };
  }
  return {
    label: 'Cloud',
    title: 'Cloud room sync is enabled',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    textClass: 'text-stone-500 dark:text-stone-400',
  };
}

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
  onSessionEvent?: (event: GroupChatSessionEvent) => void;
  /**
   * Canvas-side context for ChatInput's @-mention picker. Both come
   * straight from ProjectEditor — `mentionableNodes` is the asset /
   * media subset of the React Flow nodes already filtered + thumbnail-
   * resolved; we add invited agent on top here so the user can @ a
   * agent member from the same picker.
   */
  mentionableNodes?: MentionableNode[];
}

export function GroupChatPanel({
  projectId,
  userId,
  presenceClients,
  width,
  onWidthChange,
  isCollapsed,
  onCollapseChange,
  registerRoomSink,
  onSessionEvent,
  mentionableNodes: canvasMentionableNodes,
}: GroupChatPanelProps) {
  const navigate = useNavigate();
  const room = useProjectRoom(projectId);
  const group = useGroupChat(projectId, { onSessionEvent });
  const { agents: claimedAgent, loading: agentLoading } = useClaimedAgents();
  const [invitedIds, setInvitedIds] = useState<string[]>(() => loadInvited(projectId));
  const [activeTab, setActiveTab] = useState<string>(ROOM_TAB);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Stable id for the active tabpanel. Ariakit wires it to the selected tab.
  const panelId = useId();
  const tabIdPrefix = useId();
  const tabIdFor = useCallback(
    (key: string) => `${tabIdPrefix}-tab-${key === ROOM_TAB ? 'room' : key}`,
    [tabIdPrefix],
  );

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

  const claimById = useCallback((id: string) => claimedAgent.find((c) => c.id === id), [claimedAgent]);
  const invitedAgent = useMemo(
    () => invitedIds.map(claimById).filter((c): c is AgentRow => !!c),
    [invitedIds, claimById],
  );
  const tabKeyForId = useCallback(
    (selectedId: string | null | undefined) => {
      if (!selectedId) return null;
      if (selectedId === tabIdFor(ROOM_TAB)) return ROOM_TAB;
      return invitedAgent.find((c) => tabIdFor(c.id) === selectedId)?.id ?? null;
    },
    [invitedAgent, tabIdFor],
  );
  const handleSelectedTabIdChange = useCallback(
    (selectedId: string | null | undefined) => {
      const nextTab = tabKeyForId(selectedId);
      if (!nextTab) return;
      setActiveTab(nextTab);
      if (nextTab !== ROOM_TAB) group.focus(nextTab);
      if (isCollapsed) onCollapseChange(false);
    },
    [group, isCollapsed, onCollapseChange, tabKeyForId],
  );

  // Auto-spawn sessions for invited agent that don't have one yet.
  // Runs whenever invited list or claimed agent changes.
  useEffect(() => {
    for (const c of invitedAgent) {
      const exists = group.agent.some((x) => x.agentMemberId === c.id);
      if (!exists) {
        void group.addAgent({
          id: c.id,
          template_id: c.template_id,
          runtime_id: c.runtime_id,
          display_name: c.display_name,
        });
      }
    }
  }, [invitedAgent, group]);

  const invite = useCallback((row: AgentRow) => {
    setInvitedIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
    setShowAddMenu(false);
    setActiveTab(row.id);
  }, []);

  const uninvite = useCallback(
    (id: string) => {
      setInvitedIds((prev) => prev.filter((x) => x !== id));
      group.removeAgent(id);
      setActiveTab((cur) => (cur === id ? ROOM_TAB : cur));
    },
    [group],
  );

  // Mention name resolution: try invited agent display_name first, then
  // fall back to template id (lets `@master-clash` work as a shortcut
  // when there's exactly one matching agent invited). Returns the matching
  // claim id (= agent_member.id) or null.
  const resolveMention = useCallback(
    (handle: string): AgentRow | null => {
      const lower = handle.toLowerCase();
      const byName = invitedAgent.find((c) => agentHandle(c.display_name) === lower);
      if (byName) return byName;
      const byTemplate = invitedAgent.filter((c) => c.template_id === lower);
      if (byTemplate.length === 1) return byTemplate[0]; // ambiguous → null
      return null;
    },
    [invitedAgent],
  );

  /**
   * Mentionable picker fed to ChatInput's MilkdownEditor. Combines
   * canvas media nodes (passed in by ProjectEditor) and currently
   * invited agent so the user can `@` either kind from one list.
   * Agent get a stable id namespace (their `agent_member.id`) so
   * onChatSubmit can route each mention to the right channel
   * (room.mentions[] vs inline canvas reference).
   */
  const mentionableNodes = useMemo<MentionableNode[]>(() => {
    const agent: MentionableNode[] = invitedAgent.map((c) => ({
      id: c.id,
      type: 'agent',
      label: c.display_name,
    }));
    return [...agent, ...(canvasMentionableNodes ?? [])];
  }, [invitedAgent, canvasMentionableNodes]);

  /** Set of agent_member.ids so submit-time partitioning is O(1). */
  const invitedAgentIdSet = useMemo(
    () => new Set(invitedAgent.map((c) => c.id)),
    [invitedAgent],
  );

  /**
   * ChatInput submit handler. Receives markdown text containing
   * inline mentions in the canonical `@[label](node:id)` form (or
   * `@<handle>` legacy plain-text form), plus any uploaded
   * attachments. Splits agent mentions out into the room API's
   * `mentions[]` array; canvas mentions stay in the text body so
   * the message renderer can inline-thumbnail them on display.
   */
  const onChatSubmit = useCallback(
    async (text: string, _attachments: UploadedAttachment[] = []) => {
      const value = text.trim();
      if (!value) return;
      void _attachments; // attachments wired in next pass (asset/upload plumbing)

      const agentMentions: Array<{ user_id: string; agent_member_id: string }> = [];
      // ChatInput emits `@[label](node:<id>)` for every picker selection.
      // Defensive: some older Milkdown builds (and any human typing a
      // title attribute) emit `[label](node:<id> "title")`; capturing
      // up to the first whitespace OR `)` keeps the id clean either way.
      const re = /@\[[^\]]*\]\(node:([^\s)]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(value)) !== null) {
        const id = m[1];
        if (invitedAgentIdSet.has(id)) {
          agentMentions.push({ user_id: userId, agent_member_id: id });
        }
      }

      // Fall back to legacy plain `@<handle>` syntax if no
      // structured agent mention found (lets a user typing a bare
      // @master-clash still address an agent).
      if (agentMentions.length === 0) {
        const { agentMemberId: handle } = parseMention(value);
        const target = handle ? resolveMention(handle) : null;
        if (target) agentMentions.push({ user_id: userId, agent_member_id: target.id });
      }

      setDraft('');
      // POST to room — server's mention dispatcher pushes a room.mention
      // frame to the target agent's session; useGroupChat queues it; one
      // dispatch path (don't also call sendToFocused here, or the agent
      // receives the same message twice).
      await room.send(value, agentMentions);

      // Switch focus to the (first) target agent so reply streams into
      // the right tab.
      if (agentMentions[0]) group.focus(agentMentions[0].agent_member_id);
    },
    [userId, room, group, resolveMention, invitedAgentIdSet],
  );

  // Kept for back-compat with the (now-deprecated) plain-text composer
  // path. The new ChatInput owns its own input state — no autocomplete
  // hook needed here since MilkdownEditor's @-picker covers it.
  const ac = useMentionAutocomplete(draft, setDraft, textareaRef, invitedAgent);
  void ac;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Legacy textarea was replaced with <ChatInput>; this handler is
    // never wired anymore. Keep the no-op so dead refs don't crash if
    // anything still hooks into it during the migration.
    void e;
  };

  // Resize handle on the LEFT edge of the panel. Drag left → wider,
  // drag right → narrower. Installs a global mousemove only for the
  // duration of the drag so we don't leak listeners on idle hover.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (moveEvent: MouseEvent) => {
        // Handle is on the left edge of the panel, so dragging LEFT
        // (negative delta) should INCREASE width.
        const next = Math.max(
          PANEL_MIN_WIDTH,
          Math.min(PANEL_MAX_WIDTH, startWidth - (moveEvent.clientX - startX)),
        );
        onWidthChange(next);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      // Make the cursor stick to ew-resize for the whole drag, even
      // when the pointer briefly leaves the handle.
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [width, onWidthChange],
  );

  // After switching back to Room, drop focus into the composer so the
  // user can start typing without a second click. Skip on initial mount
  // (no prior tab → don't auto-grab focus when the page loads).
  const lastTabRef = useRef(activeTab);
  useEffect(() => {
    if (lastTabRef.current !== activeTab && activeTab === ROOM_TAB) {
      textareaRef.current?.focus();
    }
    lastTabRef.current = activeTab;
  }, [activeTab]);

  // Collapsed-state design: rail stays put on the right edge, the
  // panel card hides. The chevron in the rail flips direction so it
  // points "into" what clicking will reveal (left = pull the panel
  // back into view; right = push it away to the right). Status dots
  // on the rail's agent avatars give the user the same presence
  // signal a separate floating PresenceBar would.

  const uninvitedClaimed = claimedAgent.filter((c) => !invitedIds.includes(c.id));
  const focusedAgent = group.agent.find((c) => c.agentMemberId === activeTab);
  const firstInvitedHandle = invitedAgent[0] && agentHandle(invitedAgent[0].display_name);

  // "Other clients" — humans / cli / agents connected to this project's
  // ProjectRoom besides the local user. Mirrors the canvas presence
  // filter (ProjectEditor.tsx:315) so the same set of dots shows up
  // here and on the canvas, never inflated by your own browser session.
  const otherClients = visiblePresenceClients(presenceClients, userId);

  // User session + billing — drives the rail-bottom avatar + balance
  // pill. `balance.status === 'unavailable'` means self-hosted with
  // billing disabled, in which case the balance pill stays hidden
  // (the avatar still renders so users can reach Settings).
  const session = betterAuthClient.useSession();
  const sessionUser = session.data?.user;
  const balance = useBillingBalance(!!sessionUser);
  const userInitials = (sessionUser?.name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const activeTabLabel = activeTab === ROOM_TAB ? 'Room' : focusedAgent?.agentMemberId
    ? invitedAgent.find((c) => c.id === activeTab)?.display_name ?? 'Agent'
    : 'Room';
  const syncIndicator = roomSyncIndicator(room.sync);

  return (
    <TabProvider
      selectedId={tabIdFor(activeTab)}
      setSelectedId={handleSelectedTabIdChange}
      orientation="vertical"
      focusLoop
    >
    <div className="h-full flex items-stretch gap-2">
      {/* ── Left rail — FLOATS OUTSIDE the panel card ────────────
          Bare transparent column with stacked avatar buttons. Sits
          to the LEFT of the panel card with a small gap. Width
          footprint accounted for in CHAT_PANEL_RAIL_WIDTH. */}
      <aside className="relative z-30 shrink-0 w-12 flex flex-col items-center gap-1.5 py-3 pointer-events-auto">
        <motion.button
          onClick={() => onCollapseChange(!isCollapsed)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="h-9 w-9 flex items-center justify-center hover:bg-warm-hover rounded-full text-stone-700 dark:text-stone-300 dark:text-stone-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          aria-label={isCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
          title={isCollapsed ? 'Open chat' : 'Collapse'}
        >
          {/* When collapsed the panel is hidden to the right of the
              rail; clicking should pull it BACK into view (← left).
              When expanded clicking pushes it AWAY (→ right). */}
          {isCollapsed ? (
            <CaretLeft className="w-4 h-4" weight="bold" aria-hidden="true" />
          ) : (
            <CaretRight className="w-4 h-4" weight="bold" aria-hidden="true" />
          )}
        </motion.button>

        <div className="my-1 h-px w-8 bg-warm-border" aria-hidden="true" />

        <TabList
          aria-label="Chat tabs"
          className="flex flex-col items-center gap-1.5 overflow-y-auto scrollbar-thin flex-1 min-h-0 w-full"
        >
          {/* Tap on any rail action (tab, invite) implicitly expands
              the panel — only the chevron is an explicit toggle. The
              intent is "I want to use the chat"; making the user
              click chevron first would feel pointless. */}
          <TabPill
            label="Room"
            active={activeTab === ROOM_TAB}
            onClick={() => {
              if (isCollapsed) onCollapseChange(false);
            }}
            kind="room"
            tabId={tabIdFor(ROOM_TAB)}
            compact
          />
          {invitedAgent.map((c) => {
            const live = group.agent.find((x) => x.agentMemberId === c.id);
            return (
              <TabPill
                key={c.id}
                label={c.display_name}
                active={activeTab === c.id}
                onClick={() => {
                  if (isCollapsed) onCollapseChange(false);
                }}
                onClose={() => uninvite(c.id)}
                unread={!!live?.unread}
                pendingCount={live?.pendingPrompts.length ?? 0}
                status={live?.status}
                initials={agentInitials(c.display_name)}
                tabId={tabIdFor(c.id)}
                compact
              />
            );
          })}

          <InviteAgentMenu
            open={showAddMenu}
            onToggle={() => {
              setShowAddMenu((v) => !v);
              if (isCollapsed) onCollapseChange(false);
            }}
            uninvitedClaimed={uninvitedClaimed}
            totalClaimed={claimedAgent.length}
            loading={agentLoading}
            onInvite={invite}
            onOpenSettings={() => navigate('/settings')}
          />

          {/* Refresh sits immediately under the + button — same
              size + shape so they read as a paired tool cluster
              ("add agent" / "reload room"). */}
          <motion.button
            onClick={() => void room.refetch()}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="h-11 w-11 rounded-matrix bg-warm-muted hover:bg-warm-hover hover:text-brand text-stone-700 dark:text-stone-300 dark:text-stone-400 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface"
            aria-label="Refresh room"
            title="Refresh room"
          >
            <ArrowClockwise className="w-4 h-4" weight="bold" aria-hidden="true" />
          </motion.button>
        </TabList>

        {/* Rail footer: avatar (opens Settings) + balance pill (hosted
            version only — hidden when billing is unavailable on a
            self-hosted deploy). Multi-user presence stacks above. */}
        {otherClients.length > 0 && (
          <div className="my-1">
            <PresenceBar clients={otherClients} />
          </div>
        )}
        <Link
          to="/settings"
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface"
          aria-label={`Settings — signed in as ${sessionUser?.name ?? 'guest'}`}
          title={sessionUser?.name ?? 'Settings'}
        >
          {sessionUser?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sessionUser.image}
              alt="Your avatar"
              className="h-9 w-9 rounded-xl object-cover ring-1 ring-warm-border hover:ring-brand/60 transition-all"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-light text-xs font-bold text-slate-950 ring-1 ring-brand/20 transition-all hover:ring-brand/60 dark:bg-brand/20 dark:text-slate-50">
              {userInitials}
            </div>
          )}
        </Link>
        {(balance.status === 'ready' || balance.status === 'loading') && (
          <Link
            to="/billing"
            className="flex flex-col items-center gap-0.5 text-[10px] font-medium text-stone-700 dark:text-stone-300 dark:text-stone-300 hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface rounded-md px-1 py-0.5"
            aria-label="Credits balance — click to manage billing"
            title="Credits balance"
          >
            <Lightning weight="fill" className="h-3 w-3 text-brand" aria-hidden="true" />
            {balance.status === 'ready' ? (
              <span className="tabular-nums">
                {balance.balance.available.toLocaleString()}
              </span>
            ) : (
              <span className="inline-block h-2 w-6 rounded bg-warm-muted animate-pulse" />
            )}
          </Link>
        )}
      </aside>

      {/* ── Panel card — resizable, contains message body + composer.
          Hidden when isCollapsed; the rail above stays visible so
          the user keeps the tab list + agent presence on screen.
          Constants PANEL_MIN_WIDTH / PANEL_MAX_WIDTH bound the
          resize handle range.
          Collapse/expand animates the shell's `width` (and opacity)
          between 0 and panelWidth. Inner card holds its full width
          throughout — the shell's `overflow: hidden` clips it during
          the transition so text never reflows mid-animation. */}
      {/* The panel-shell stays mounted regardless of collapse state —
          we animate width/opacity in place instead of letting
          AnimatePresence unmount on exit. AnimatePresence removes the
          DOM node the instant the exit transition finishes; the
          surrounding flex container then reflows from 2 children to 1
          on the same render tick, producing a visible "jolt" on the
          final frame even with a critically-damped spring. Always-
          mounted + `animate` between two targets sidesteps that — the
          rail's flex position never changes, only the panel-shell's
          width does. `pointer-events: none` when collapsed keeps focus
          / clicks from reaching the (invisibly clipped) content. */}
      <motion.div
        key="panel-shell"
        initial={false}
        animate={{
          width: isCollapsed ? 0 : width,
          opacity: isCollapsed ? 0 : 1,
        }}
        transition={{
          width: { type: 'spring', stiffness: 400, damping: 40 },
          opacity: { duration: 0.16, ease: 'easeOut' },
        }}
        style={{ overflow: 'hidden', pointerEvents: isCollapsed ? 'none' : 'auto' }}
        aria-hidden={isCollapsed}
        className="h-full shrink-0"
      >
      {/* Panel surface uses a vertical gradient: transparent at the
          very top (so the canvas dots fade in cleanly behind any
          first message), settling into the warm-surface/70 surface
          tone below. Combined with backdrop-blur, the top edge reads
          as a soft fade rather than a hard card boundary. */}
      <div
        className="h-full flex flex-col min-w-0 min-h-0 relative bg-gradient-to-b from-transparent via-warm-surface/70 to-warm-surface/70 backdrop-blur-sm border border-warm-border/60 shadow-sm rounded-matrix"
        style={{ width }}
      >
        {/* Resize handle: a thin transparent strip on the left edge.
            Visual feedback is a 1px brand-tinted line on hover/drag so
            it doesn't compete with the panel's border at rest. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-30 group/resize"
        >
          <div className="h-full w-full opacity-0 group-hover/resize:opacity-100 group-active/resize:opacity-100 bg-brand/40 transition-opacity" />
        </div>

        {activeTab === ROOM_TAB && (
          <div className="shrink-0 flex justify-end px-5 pb-1 pt-4">
            <div
              className={`inline-flex h-5 items-center gap-1.5 text-[11px] font-medium ${syncIndicator.textClass}`}
              title={syncIndicator.title}
              aria-label={syncIndicator.title}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${syncIndicator.dotClass}`} aria-hidden="true" />
              <span>{syncIndicator.label}</span>
            </div>
          </div>
        )}

        {/* Body */}
         <TabPanel
           id={panelId}
           tabId={tabIdFor(activeTab)}
           aria-label={`${activeTabLabel} content`}
           className="flex-1 px-5 min-h-0"
         >
          {activeTab === ROOM_TAB ? (
            <RoomView
              messages={room.messages}
              userId={userId}
              labelFor={(id) => claimById(id)?.display_name ?? id}
              empty={!room.loading && room.messages.length === 0}
              hasInvited={invitedAgent.length > 0}
              mentionableNodes={mentionableNodes}
              sync={room.sync}
            />
          ) : (
            <AgentView
              messages={focusedAgent?.messages ?? []}
              status={focusedAgent?.status}
              errorMessage={focusedAgent?.errorMessage}
              onRetry={focusedAgent ? () => group.retryAgent?.(focusedAgent.agentMemberId) : undefined}
            />
          )}
         </TabPanel>

        {/* Input lives only on the Room tab. Agent tabs are read-only event
            streams — typing into them never made sense (the input always
            POSTed to /room anyway, with @-mention routing). Hiding it
            here makes the agent tab's purpose obvious: spectate this
            agent's tool calls + thinking. To talk to the agent, switch
            to Room and use @<name>. */}
        {activeTab === ROOM_TAB && (
        <ChatInput
          input={draft}
          onInputChange={setDraft}
          onSubmit={onChatSubmit}
          placeholder={
            invitedAgent.length === 0
              ? 'Invite a agent member with + to start chatting'
              : `Chat the room, or @${firstInvitedHandle} a agent member`
          }
          mentionableNodes={mentionableNodes}
          projectId={projectId}
          error={room.error}
          connected
          isProcessing={false}
        />)}
      </div>
      </motion.div>
    </div>
    </TabProvider>
  );
}
