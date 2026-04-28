/**
 * Shared parser for ACP `session/update` notifications + assistant-message
 * accumulator. Used by useAgentByoBridge (one-shot pair) and useClashRuntime
 * (persistent daemon) so they can't drift apart.
 *
 * If we ever decide to push event normalization server-side (see ChatbotCopilot
 * design notes), this whole module ports to the worker — clients then receive
 * pre-classified events and skip the parsing step.
 *
 * Wire shape (claude-code-acp v0.16+):
 *   { sessionId, update: { sessionUpdate: 'agent_message_chunk',
 *                          content: { type: 'text', text: '...' } } }
 *   { sessionId, update: { sessionUpdate: 'tool_call', toolCall: { ... } } }
 *
 * Older openma-vendored shape exposed sessionUpdate at the top level —
 * we accept both so a chat that mixes sources renders consistently.
 */

export interface ByoMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_call'; name: string; input?: unknown; output?: unknown }
    | { type: 'raw_event'; event: unknown }
  >;
}

interface ParsedEvent {
  kind: 'text' | 'tool_call' | 'raw';
  /** For 'text' events. */
  text?: string;
  /** For 'tool_call' events. */
  toolCall?: { name?: string; input?: unknown; output?: unknown };
  /** Original event, used for the raw_event fallback. */
  event: unknown;
}

export function parseAcpEvent(event: unknown): ParsedEvent {
  const ev = event as {
    sessionUpdate?: string;
    update?: { sessionUpdate?: string; content?: { type?: string; text?: string }; toolCall?: unknown };
    content?: { type?: string; text?: string };
    toolCall?: unknown;
  };
  const update = ev?.update?.sessionUpdate ?? ev?.sessionUpdate;
  const content = ev?.update?.content ?? ev?.content;
  const toolCall = ev?.update?.toolCall ?? ev?.toolCall;

  if ((update === 'agent_message_chunk' || update === 'agent_thought_chunk') && typeof content?.text === 'string') {
    return { kind: 'text', text: content.text, event };
  }
  if (update === 'tool_call' && toolCall) {
    return { kind: 'tool_call', toolCall: toolCall as ParsedEvent['toolCall'], event };
  }
  return { kind: 'raw', event };
}

/**
 * Append a parsed ACP event to the message bubble for `turnId`.
 * Mutates `messages` (caller is responsible for cloning before this if
 * passing a state slice — both callers do).
 *
 * Returns the (possibly created) bubble index; useful for the caller to
 * cache turnId → idx if they want O(1) routing on subsequent events.
 */
export function appendAcpEvent(
  messages: ByoMessage[],
  turnId: string,
  knownIdx: number | undefined,
  event: unknown,
): number {
  const ensure = (): number => {
    if (knownIdx !== undefined) return knownIdx;
    const newIdx = messages.length;
    messages.push({ id: `asst-${turnId}`, role: 'assistant', parts: [] });
    return newIdx;
  };
  const parsed = parseAcpEvent(event);

  if (parsed.kind === 'text' && typeof parsed.text === 'string') {
    const i = ensure();
    const last = messages[i].parts[messages[i].parts.length - 1];
    if (last && last.type === 'text') last.text += parsed.text;
    else {
      messages[i] = {
        ...messages[i],
        parts: [...messages[i].parts, { type: 'text', text: parsed.text }],
      };
    }
    return i;
  }

  if (parsed.kind === 'tool_call' && parsed.toolCall) {
    const i = ensure();
    const tc = parsed.toolCall;
    messages[i] = {
      ...messages[i],
      parts: [...messages[i].parts, { type: 'tool_call', name: tc.name ?? 'tool', input: tc.input, output: tc.output }],
    };
    return i;
  }

  // Raw fallback: keep the event so debugging is possible without losing data.
  const i = ensure();
  messages[i] = {
    ...messages[i],
    parts: [...messages[i].parts, { type: 'raw_event', event }],
  };
  return i;
}
