/**
 * Per-crew tab body — full ACP event stream (tool calls, streamed text,
 * plan updates, etc) for one invited crew. Same renderer as the old
 * single-agent panel so users see the formatting they're used to.
 *
 * Auto-scrolls on new messages with the same near-bottom rule as
 * RoomView. If the crew session errored, surface the error inline with
 * a Retry button so the user doesn't have to remove + re-add to recover.
 */

import { ArrowDown, ArrowClockwise, Warning } from '@phosphor-icons/react';
import { AcpMessageList } from '@clash/web-ui/components/copilot/AcpMessageList';
import { useChatScroll } from '@clash/web-ui/hooks/useChatScroll';
import type { ByoMessage } from '@clash/web-ui/lib/acpEvents';

interface CrewViewProps {
  messages: ByoMessage[];
  /** Live status; null means we haven't established a session yet. */
  status?: string;
  errorMessage?: string | null;
  /** Called when the user clicks Retry on an errored session. */
  onRetry?: () => void;
}

export function CrewView({ messages, status, errorMessage, onRetry }: CrewViewProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages.length);
  const isErrored = status === 'error' || status === 'disconnected';

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      {isErrored && (
        <div className="mb-3 px-3 py-2 rounded-matrix bg-red-50 border border-red-200 flex items-center gap-2 text-xs">
          <Warning className="w-4 h-4 text-red-600 shrink-0" weight="fill" />
          <div className="flex-1 text-red-800">
            <div className="font-medium">Crew {status === 'error' ? 'errored' : 'disconnected'}</div>
            {errorMessage && <div className="text-[11px] text-red-700/80 mt-0.5">{errorMessage}</div>}
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-red-100 hover:bg-red-200 text-red-800 transition-colors"
            >
              <ArrowClockwise className="w-3 h-3" weight="bold" />
              Retry
            </button>
          )}
        </div>
      )}
      <div className="space-y-3">
        <AcpMessageList
          messages={messages}
          emptyHint="No messages yet for this crew. @-mention them in the Room to get them going."
        />
      </div>
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
