/**
 * Per-agent tab body — full ACP event stream (tool calls, streamed text,
 * etc) for one invited agent. Same renderer as the old single-agent
 * panel so users see the formatting they're used to.
 *
 * Layout:
 *   ┌────────────────────────────────────┐
 *   │ scrollable message log             │ ← messages
 *   │                                    │
 *   │   ← "New messages" float           │
 *   ├────────────────────────────────────┤
 *   │ Plan • 5/9 • current step  ⌃       │ ← sticky PlanBar
 *   └────────────────────────────────────┘
 *
 * Plan is a per-session snapshot — it doesn't belong inline in the
 * message stream (the original placement put it at the random
 * position of the *first* plan event, mid-conversation). Instead we
 * scan the bubbles for the latest `plan` part and pin a slim,
 * always-visible bar at the bottom that opens upward.
 *
 * a11y: error banner is `role="alert" aria-live="assertive"`; the
 * message log itself is `role="log" aria-live="polite"` (additions
 * only) so streamed text doesn't flood the screen reader.
 */

import { ArrowDown, ArrowClockwise, Warning, CircleNotch } from '@phosphor-icons/react';
import { AcpMessageList } from '@clash/web-ui/components/copilot/AcpMessageList';
import { useChatScroll } from '@clash/web-ui/hooks/useChatScroll';
import type { ByoMessage } from '@clash/web-ui/lib/acpEvents';
import { PlanBar } from '../components/ai-elements';
import { Button } from '../components/ui/button';

interface AgentViewProps {
  messages: ByoMessage[];
  /** Live status; null means we haven't established a session yet. */
  status?: string;
  errorMessage?: string | null;
  /** Called when the user clicks Retry on an errored session. */
  onRetry?: () => void;
}

export function AgentView({ messages, status, errorMessage, onRetry }: AgentViewProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useChatScroll(messages.length);
  const isErrored = status === 'error' || status === 'disconnected';
  const isReconnecting = status === 'reconnecting';

  // Latest plan snapshot across the whole transcript. We scan from
  // the END backward (cheaper for long sessions) and take the first
  // `plan` part we hit — that's the most recent emission since the
  // parser replaces existing plan parts in-place.
  const latestPlan = (() => {
    for (let m = messages.length - 1; m >= 0; m--) {
      const parts = messages[m].parts;
      for (let p = parts.length - 1; p >= 0; p--) {
        const part = parts[p];
        if (part.type === 'plan') return part.entries;
      }
    }
    return null;
  })();

  return (
    <div className="h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto chat-scroll-hidden"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Agent event stream"
      >
        {isReconnecting && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 px-3 py-2 rounded-matrix bg-status-busy/10 border border-status-busy/30 flex items-center gap-2 text-xs"
          >
            <CircleNotch className="w-4 h-4 text-status-busy shrink-0 animate-spin" weight="bold" aria-hidden="true" />
            <div className="flex-1 text-stone-800 dark:text-stone-100">
              <div className="font-medium">Reconnecting</div>
              <div className="text-[11px] text-stone-600 dark:text-stone-300 mt-0.5">
                {errorMessage ?? 'Waiting for runtime to come back online — your messages stay queued.'}
              </div>
            </div>
          </div>
        )}
        {isErrored && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-3 px-3 py-2 rounded-matrix bg-status-down/10 border border-status-down/30 flex items-center gap-2 text-xs"
          >
            <Warning className="w-4 h-4 text-status-busy shrink-0" weight="fill" aria-hidden="true" />
            <div className="flex-1 text-stone-800 dark:text-stone-100">
              <div className="font-medium">Agent {status === 'error' ? 'errored' : 'disconnected'}</div>
              {errorMessage && (
                <div className="text-[11px] text-stone-600 dark:text-stone-300 mt-0.5">{errorMessage}</div>
              )}
            </div>
            {onRetry && (
              <Button
                onClick={onRetry}
                size="md"
                leftIcon={<ArrowClockwise className="w-3.5 h-3.5" weight="bold" />}
                className="text-xs"
                aria-label="Retry agent session"
              >
                Retry
              </Button>
            )}
          </div>
        )}
        <div className="space-y-3">
          <AcpMessageList
            messages={messages}
            emptyHint="No messages yet for this agent. @-mention them in the Room to get them going."
          />
        </div>
        {!isAtBottom && (
          <Button
            onClick={scrollToBottom}
            variant="primary"
            size="md"
            shape="pill"
            leftIcon={<ArrowDown className="w-3.5 h-3.5" weight="bold" />}
            className="sticky bottom-2 mx-auto mt-2 z-10 focus-visible:ring-offset-1"
            aria-label="Scroll to latest message"
          >
            New messages
          </Button>
        )}
      </div>
      {latestPlan && (
        <div className="shrink-0 pt-2">
          <PlanBar entries={latestPlan} />
        </div>
      )}
    </div>
  );
}
