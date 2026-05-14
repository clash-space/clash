/**
 * Room tab body — project-wide IM log: humans typing + crew broadcasts
 * (server's mention dispatcher echoes those into room frames).
 *
 * Auto-scrolls to bottom on new messages when the user was already at
 * (or near) the bottom; otherwise leaves them where they are and shows
 * a "jump to latest" button so they can opt back in.
 */

import { motion } from 'framer-motion';
import { ArrowDown } from '@phosphor-icons/react';
import type { RoomMessageEvent } from '@clash/shared-types';
import { useChatScroll } from '@clash/web-ui/hooks/useChatScroll';

interface RoomViewProps {
  messages: RoomMessageEvent[];
  userId: string;
  /** Resolve a sender_id (crew_member.id) to the display name shown
   *  on its tab. Falls back to id if not found in invited crew. */
  labelFor: (id: string) => string;
  empty: boolean;
  hasInvited: boolean;
}

export function RoomView({ messages, userId, labelFor, empty, hasInvited }: RoomViewProps) {
  // Always render the scrollable container so useChatScroll's effect
  // sees a real DOM node on first mount and attaches its scroll listener.
  // Switching to a different JSX tree for the empty state (the previous
  // version's `if (empty) return <div>…`) caused the ref to be null when
  // the effect ran, then the effect never re-ran after messages arrived
  // → the "New messages ↓" button never showed and isAtBottom stayed stuck.
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages.length);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      {empty ? (
        <div className="text-center text-sm text-stone-400 py-12">
          {hasInvited ? (
            <>
              Nothing in the room yet. Try{' '}
              <code className="px-1.5 py-0.5 rounded bg-brand-light text-brand font-mono">@&lt;name&gt;</code> to address
              a crew member.
            </>
          ) : (
            <>
              Invite a crew member with the <span className="px-1.5 py-0.5 rounded bg-warm-muted">+</span> button to
              start.
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
        {messages.map((m) => {
          const isMe = m.sender_kind === 'user' && m.sender_user_id === userId;
          const sender =
            m.sender_kind === 'crew' ? labelFor(m.sender_id) : isMe ? 'You' : m.sender_id.slice(0, 8);
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
                  className={`px-4 py-2.5 rounded-matrix text-sm whitespace-pre-wrap break-words shadow-sm select-text ${
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
      )}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-2 mx-auto mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full bg-brand text-white shadow-lg hover:bg-brand/90 transition-all z-10"
          aria-label="Scroll to latest message"
        >
          <ArrowDown className="w-3 h-3" weight="bold" />
          New messages
        </button>
      )}
    </div>
  );
}
