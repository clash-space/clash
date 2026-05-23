/**
 * Render a stream of ACP-derived messages with the Vercel ai-elements
 * component family — verbatim ports of their Tool / Reasoning /
 * Response components live under `../ai-elements/`. This is the
 * single rendering source of truth for every chat surface in the app.
 *
 * Why the upstream components instead of bespoke wrappers: agents
 * emit markdown (tables, headings, bold) that needs proper renderer
 * support; ai-elements is the standard for Vercel AI SDK chats and
 * the visual language people expect.
 */

import { motion } from 'framer-motion';
import type { ByoMessage } from '@clash/web-ui/lib/acpEvents';
import type { ToolUIPart } from 'ai';
import { EmptyState } from '../../_group-chat/EmptyState';
import {
  Response,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  Message,
  MessageContent,
} from '../ai-elements';

/**
 * Map claude-code-acp's `status` string onto Vercel's ToolUIPart
 * `state` enum so the upstream Tool components light up the right
 * status badge + icon without us forking their type system.
 *
 * Heuristic: claude-code-acp's stream isn't fully reliable — about
 * 5% of tool calls never receive their final `status: completed`
 * update before the turn flushes, so they'd otherwise look "Running"
 * forever even after output is sitting right there. When we have an
 * output (or errorText) but only a non-terminal status, infer the
 * terminal state from the output's shape so the badge matches what
 * the user can already see in the body.
 */
function acpStatusToToolState(
  status: string | undefined,
  output: unknown,
): ToolUIPart['state'] {
  if (status === 'completed') return 'output-available';
  if (status === 'failed') return 'output-error';
  // Non-terminal status but output exists → infer completion.
  if (output !== undefined && output !== null && output !== '') {
    const looksLikeError =
      typeof output === 'string' &&
      /^(error|exit code [1-9]|traceback|stderr)/i.test(output.trim());
    return looksLikeError ? 'output-error' : 'output-available';
  }
  if (status === 'in_progress' || status === 'pending') return 'input-available';
  return 'input-streaming';
}

export function AcpMessageList({
  messages,
  emptyHint,
}: {
  messages: ByoMessage[];
  emptyHint?: React.ReactNode;
}) {
  if (messages.length === 0) {
    return <EmptyState tone="muted">{emptyHint ?? 'No messages yet.'}</EmptyState>;
  }
  return (
    <>
      {messages.map((m) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
        >
          <Message from={m.role === 'user' ? 'user' : 'assistant'}>
            <MessageContent>
              {/* Plan parts are filtered out here and surfaced by
                  CrewView as a sticky footer (PlanBar) — they're a
                  per-crew session-wide snapshot, not part of any
                  particular bubble. */}
              {m.parts.filter((q) => q.type !== 'plan').map((p, i) => {
                if (p.type === 'text') {
                  // User messages stay plain (their input rarely contains
                  // markdown); assistant text goes through Response so
                  // GFM tables / bold / lists / code blocks render.
                  if (m.role === 'user') {
                    return (
                      <p key={i} className="text-sm leading-relaxed mb-1 last:mb-0">
                        {p.text}
                      </p>
                    );
                  }
                  return <Response key={i}>{p.text}</Response>;
                }
                if (p.type === 'thought') {
                  // Stream during the turn (auto-opens), collapses after.
                  // We don't know whether the turn is still streaming
                  // from a static event, so leave it closed by default
                  // for replayed history; live streaming flips it open
                  // via the parent's React state.
                  return (
                    <Reasoning key={i} defaultOpen={false}>
                      <ReasoningTrigger />
                      <ReasoningContent>{p.text}</ReasoningContent>
                    </Reasoning>
                  );
                }
                if (p.type === 'tool_call') {
                  // Render priority for the body: ACP `content` array
                  // (text/diff/terminal blocks the agent emitted) wins;
                  // fall back to `rawOutput` for tools that only
                  // populate the raw form.
                  const output =
                    p.content && p.content.length > 0
                      ? p.content
                          .map((c) => c.content?.text ?? '')
                          .filter(Boolean)
                          .join('\n')
                      : p.rawOutput;
                  const state = acpStatusToToolState(p.status, output);
                  return (
                    <Tool key={i} defaultOpen={state === 'output-error'}>
                      <ToolHeader
                        type="dynamic-tool"
                        toolName={p.toolName || p.title || 'tool'}
                        state={state}
                        previewInput={p.rawInput}
                      />
                      <ToolContent>
                        {p.rawInput !== undefined && (
                          <ToolInput input={p.rawInput as ToolUIPart['input']} />
                        )}
                        {output !== undefined && output !== null && output !== '' && (
                          <ToolOutput
                            output={output as ToolUIPart['output']}
                            errorText={
                              state === 'output-error' && typeof output === 'string'
                                ? output
                                : undefined
                            }
                          />
                        )}
                      </ToolContent>
                    </Tool>
                  );
                }
                // (plan parts are filtered out above and pinned to
                // the top of the bubble — they never reach this map.)
                // raw_event fallback — show update kind in summary so
                // unhandled ACP frames are at least identifiable.
                const ev = p.event as { update?: { sessionUpdate?: string }; sessionUpdate?: string } | null | undefined;
                const kind = ev?.update?.sessionUpdate ?? ev?.sessionUpdate ?? 'unknown';
                return (
                  <details key={i} className="text-[11px] font-mono text-muted-foreground group">
                    <summary className="cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm select-none list-none">
                      <span
                        className="inline-block w-2 mr-0.5 transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      >
                        ▸
                      </span>
                      event: {kind}
                    </summary>
                    <pre className="mt-1 bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(p.event, null, 2)}
                    </pre>
                  </details>
                );
              })}
            </MessageContent>
          </Message>
        </motion.div>
      ))}
    </>
  );
}
