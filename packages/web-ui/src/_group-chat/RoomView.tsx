/**
 * Room tab body — project-wide IM log: humans typing + crew broadcasts
 * (server's mention dispatcher echoes those into room frames).
 *
 * Auto-scrolls to bottom on new messages when the user was already at
 * (or near) the bottom; otherwise leaves them where they are and shows
 * a "jump to latest" button so they can opt back in.
 *
 * a11y: container is `role="log" aria-live="polite" aria-relevant="additions"`
 * so screen readers announce new messages as they arrive, without
 * blasting the entire transcript on first render.
 */

import { motion } from 'framer-motion';
import { ArrowDown } from '@phosphor-icons/react';
import type { RoomMessageEvent } from '@clash/shared-types';
import { useChatScroll } from '@clash/web-ui/hooks/useChatScroll';
import type { RoomSyncMeta } from '@clash/web-ui/hooks/useProjectRoom';
import { EmptyState } from './EmptyState';
import { UserMessage } from '../components/copilot/UserMessage';
import type { MentionableNode } from '../components/MilkdownEditor';

interface RoomViewProps {
  messages: RoomMessageEvent[];
  userId: string;
  /** Resolve a sender_id (crew_member.id) to the display name shown
   *  on its tab. Falls back to id if not found in invited crew. */
  labelFor: (id: string) => string;
  empty: boolean;
  hasInvited: boolean;
  /** Canvas-side + crew mention list — drives UserMessage's inline
   *  asset-thumbnail substitution for `@[label](node:id)` mentions. */
  mentionableNodes?: MentionableNode[];
  sync?: RoomSyncMeta | null;
}

export function RoomView({ messages, userId, labelFor, empty, hasInvited, mentionableNodes, sync }: RoomViewProps) {
  void sync;
  // Always render the scrollable container so useChatScroll's effect
  // sees a real DOM node on first mount and attaches its scroll listener.
  // Switching to a different JSX tree for the empty state (the previous
  // version's `if (empty) return <div>…`) caused the ref to be null when
  // the effect ran, then the effect never re-ran after messages arrived
  // → the "New messages ↓" button never showed and isAtBottom stayed stuck.
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages.length);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto chat-scroll-hidden"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Room messages"
    >
      {empty ? (
        <EmptyState>
          {hasInvited ? (
            <>
              Nothing in the room yet. Try{' '}
              <code className="px-1.5 py-0.5 rounded bg-brand-light text-brand font-mono">@&lt;name&gt;</code> to address
              a crew member.
            </>
          ) : (
            <>
              Invite a crew member with the{' '}
              <span className="px-1.5 py-0.5 rounded bg-warm-muted">+</span> button to start.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="px-2">
          {messages.map((m) => {
            const isMe = m.sender_kind === 'user' && m.sender_user_id === userId;
            const sender =
              m.sender_kind === 'crew' ? labelFor(m.sender_id) : isMe ? 'You' : m.sender_id.slice(0, 8);
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="pb-6"
              >
                {/* Sender label appears above every bubble — for the
                    user's own messages it's "You" on the right, for
                    crew it's the crew name, for other humans it's a
                    short id. */}
                <div
                  className={`text-[11px] text-stone-500 dark:text-stone-400 mb-1 px-1 ${
                    isMe ? 'text-right' : ''
                  }`}
                >
                  {sender}
                </div>
                {isMe ? (
                  // Restored original UserMessage renderer: resolves
                  // `@[label](node:id)` mentions to inline thumbnails
                  // using mentionableNodes, otherwise renders as a
                  // pink-tinted gradient bubble.
                  <UserMessage content={m.text} mentionNodes={mentionableNodes} />
                ) : (
                  <div className={`flex ${m.sender_kind === 'crew' ? 'justify-start' : 'justify-start'}`}>
                    <div
                      className={`max-w-[82%] px-4 py-2.5 rounded-matrix text-sm whitespace-pre-wrap break-words shadow-sm select-text ${
                        m.sender_kind === 'crew'
                          ? 'bg-status-busy/10 text-stone-800 dark:text-stone-100 border border-status-busy/20'
                          : 'bg-warm-muted text-stone-800 dark:text-stone-100'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-2 mx-auto mt-2 flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-xs font-medium rounded-full bg-brand text-brand-foreground shadow-md hover:bg-brand/90 transition-colors z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-warm-surface"
          aria-label="Scroll to latest message"
        >
          <ArrowDown className="w-3.5 h-3.5" weight="bold" aria-hidden="true" />
          New messages
        </button>
      )}
    </div>
  );
}
