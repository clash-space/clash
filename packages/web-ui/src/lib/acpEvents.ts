/**
 * ACP (Agent Client Protocol) event parser + per-turn assistant message
 * accumulator. Used by `useAgentByoBridge` (one-shot pair) and
 * `useGroupChat` (persistent daemon) — they share this so the two
 * surfaces render identical bubbles for the same wire input.
 *
 * Wire shape (verified against @agentclientprotocol/sdk@0.20 types AND
 * a captured chat_message events_json from claude-code-acp):
 *
 *   SessionNotification = { sessionId, update: SessionUpdate }
 *   SessionUpdate is a discriminated union on `sessionUpdate`:
 *     - "user_message_chunk"   ContentChunk
 *     - "agent_message_chunk"  ContentChunk
 *     - "agent_thought_chunk"  ContentChunk
 *     - "tool_call"            ToolCall
 *     - "tool_call_update"     ToolCallUpdate
 *     - "plan"                 Plan
 *     - "available_commands_update" AvailableCommandsUpdate
 *     - "current_mode_update" | "config_option_update" | …  (silent for now)
 *
 * Canonical ToolCall fields per the ACP spec:
 *   { _meta?, content?: ToolCallContent[], kind?, locations?, rawInput?,
 *     rawOutput?, status?, title: string (required), toolCallId: string }
 *
 * claude-code-acp emits TWO `tool_call` events for the same toolCallId —
 * first a bare-minimum placeholder so the UI can mount a card immediately
 * (rawInput:{}, title:"Terminal"), then a filled-in version once the
 * model finishes streaming the input (rawInput:{command,...}, title:`<cmd>`).
 * THIS PARSER coalesces both kinds of `tool_call` AND every
 * `tool_call_update` into a single part keyed by toolCallId — same
 * merge rules either way: null/undefined fields = "no change".
 *
 * Our older parser invented field names ("input", "output", "name") that
 * the wire never used; the rewrite intentionally keeps the ACP names
 * (`rawInput`, `rawOutput`, `content`) so future schema changes hit one
 * place. Display-friendly derivatives (input preview, tool name) are
 * computed at render time, not stored.
 */

// ─── ACP wire shapes (subset we use) ────────────────────────────────

/** ACP-defined ToolCallContent: text content, file diff, or terminal output. */
export interface AcpToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  /** When type='content', the inner content is { type:'text', text:string } etc. */
  content?: { type?: string; text?: string; [k: string]: unknown };
  /** When type='diff' / 'terminal', other fields populate. We don't render those yet. */
  [k: string]: unknown;
}

export interface AcpToolCallPart {
  type: 'tool_call';
  /** Stable id for delta updates. */
  toolCallId: string;
  /** ACP-canonical fields, kept verbatim from the wire. */
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: AcpToolCallContent[];
  /** claude-code-acp extension under `_meta.claudeCode.toolName`. Pulled
   *  out into a top-level field for convenience — header uses it as the
   *  human label ("Bash" / "Read" / etc). */
  toolName?: string;
}

export interface PlanEntry {
  content: string;
  priority?: 'high' | 'medium' | 'low' | string;
  status: 'pending' | 'in_progress' | 'completed' | string;
}

export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

export interface ByoMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'thought'; text: string }
    | AcpToolCallPart
    | { type: 'plan'; entries: PlanEntry[] }
    | { type: 'raw_event'; event: unknown }
  >;
}

// ─── parseAcpEvent ──────────────────────────────────────────────────

type ParsedKind =
  | 'text'
  | 'thought'
  | 'tool_call'      // covers BOTH initial tool_call and any later tool_call/tool_call_update
  | 'commands'
  | 'plan'
  | 'silent'
  | 'raw';

interface ParsedEvent {
  kind: ParsedKind;
  /** For text / thought. */
  text?: string;
  /** For tool_call (initial or update). Field set follows the wire —
   *  null fields are dropped, undefined fields stay undefined. */
  tool?: Partial<AcpToolCallPart> & { toolCallId: string };
  /** For commands events. */
  commands?: AvailableCommand[];
  /** For plan events — full snapshot. */
  plan?: PlanEntry[];
  /** Original event, used for the raw_event fallback. */
  event: unknown;
}

/** Updates we drop silently — they're protocol signaling, not user content. */
const SILENT_SESSION_UPDATES = new Set([
  'current_mode_update',
  'config_option_update',
  'session_info_update',
  'usage_update',
]);

/** Normalize a wire ToolCall(Update) object into our ParsedEvent.tool shape.
 *  ACP spec says null/missing fields on an update mean "no change"; we
 *  preserve that by only setting fields whose wire value is non-null. */
function normalizeToolCall(raw: Record<string, unknown>): Partial<AcpToolCallPart> & { toolCallId: string } {
  const tc: Partial<AcpToolCallPart> & { toolCallId: string } = {
    toolCallId: String(raw.toolCallId ?? ''),
  };
  if (typeof raw.title === 'string') tc.title = raw.title;
  if (typeof raw.kind === 'string') tc.kind = raw.kind;
  if (typeof raw.status === 'string') tc.status = raw.status;
  if (raw.rawInput !== undefined && raw.rawInput !== null) tc.rawInput = raw.rawInput;
  if (raw.rawOutput !== undefined && raw.rawOutput !== null) tc.rawOutput = raw.rawOutput;
  if (Array.isArray(raw.content)) tc.content = raw.content as AcpToolCallContent[];
  const meta = raw._meta as { claudeCode?: { toolName?: string } } | undefined;
  if (typeof meta?.claudeCode?.toolName === 'string') tc.toolName = meta.claudeCode.toolName;
  return tc;
}

export function parseAcpEvent(event: unknown): ParsedEvent {
  // ACP SessionNotification wraps the update under `update`. Older
  // openma-vendored shape exposed sessionUpdate at the top level —
  // accept both so a chat mixing sources still parses cleanly.
  const ev = event as { sessionUpdate?: string; update?: Record<string, unknown> & { sessionUpdate?: string } };
  const inner = (ev?.update ?? ev) as Record<string, unknown>;
  const update = (inner.sessionUpdate as string | undefined) ?? ev?.sessionUpdate;

  if (!update) {
    if (inner.type === 'text' && typeof inner.text === 'string' && inner.text.length > 0) {
      return { kind: 'text', text: inner.text, event };
    }
    if (inner.type === 'thought' && typeof inner.text === 'string' && inner.text.length > 0) {
      return { kind: 'thought', text: inner.text, event };
    }
    return { kind: 'raw', event };
  }

  // ─── text / thought (ContentChunk) ──────────────────────────────
  if (update === 'agent_message_chunk' || update === 'agent_thought_chunk') {
    const content = inner.content as { type?: string; text?: string } | undefined;
    if (typeof content?.text !== 'string') return { kind: 'silent', event };
    if (content.text.length === 0) return { kind: 'silent', event };
    return {
      kind: update === 'agent_thought_chunk' ? 'thought' : 'text',
      text: content.text,
      event,
    };
  }

  // user_message_chunk: agent is echoing the user's input back. We
  // already render the user's bubble from the optimistic dispatchPrompt
  // path, so skip silently to avoid a duplicate.
  if (update === 'user_message_chunk') return { kind: 'silent', event };

  // ─── tool_call / tool_call_update (treated identically) ─────────
  // claude-code-acp emits two `tool_call` events for the same id (a
  // bare skeleton, then the filled-in input/title) before any
  // `tool_call_update`s. All three frames carry the same toolCallId
  // and have the same field shape — coalesce in the merger.
  if (update === 'tool_call' || update === 'tool_call_update') {
    if (typeof inner.toolCallId !== 'string' || !inner.toolCallId) {
      return { kind: 'raw', event };
    }
    return { kind: 'tool_call', tool: normalizeToolCall(inner), event };
  }

  // ─── plan ────────────────────────────────────────────────────────
  if (update === 'plan' && Array.isArray(inner.entries)) {
    const entries = (inner.entries as unknown[])
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .map((e) => ({
        content: typeof e.content === 'string' ? e.content : '',
        priority: typeof e.priority === 'string' ? e.priority : undefined,
        status: typeof e.status === 'string' ? e.status : 'pending',
      }));
    return { kind: 'plan', plan: entries, event };
  }

  // ─── available_commands_update (slash menu) ─────────────────────
  if (update === 'available_commands_update' && Array.isArray(inner.availableCommands)) {
    return {
      kind: 'commands',
      commands: inner.availableCommands as AvailableCommand[],
      event,
    };
  }

  if (SILENT_SESSION_UPDATES.has(update)) return { kind: 'silent', event };
  return { kind: 'raw', event };
}

// ─── appendAcpEvent ─────────────────────────────────────────────────

export interface AppendResult {
  idx: number;
  commands?: AvailableCommand[];
}

/**
 * Append a parsed event to the right message bubble. Returns the
 * bubble index (or -1 when the event was silently dropped — caller
 * should not cache that index). Side info (e.g. command lists) goes
 * out via the `commands` field; caller copies it into hook state.
 *
 * Mutates `messages` — caller is responsible for cloning before this
 * if passing a state slice (both useGroupChat + useAgentByoBridge do).
 */
export function appendAcpEvent(
  messages: ByoMessage[],
  turnId: string,
  knownIdx: number | undefined,
  event: unknown,
): AppendResult {
  const parsed = parseAcpEvent(event);
  if (parsed.kind === 'silent') return { idx: knownIdx ?? -1 };
  if (parsed.kind === 'commands') {
    return { idx: knownIdx ?? -1, commands: parsed.commands };
  }

  const ensure = (): number => {
    if (
      knownIdx !== undefined &&
      messages[knownIdx]?.role === 'assistant' &&
      Array.isArray(messages[knownIdx].parts)
    ) {
      return knownIdx;
    }
    const existingIdx = messages.findIndex(
      (message) =>
        message.id === `asst-${turnId}` &&
        message.role === 'assistant' &&
        Array.isArray(message.parts),
    );
    if (existingIdx >= 0) return existingIdx;
    const newIdx = messages.length;
    messages.push({ id: `asst-${turnId}`, role: 'assistant', parts: [] });
    return newIdx;
  };

  // ─── plan: snapshot semantics ───────────────────────────────────
  // Plan is re-emitted as a full snapshot every time the agent
  // updates its TODO list. Replace any existing plan part on the
  // bubble so the user sees the latest state, not a stack of
  // intermediate plans.
  if (parsed.kind === 'plan' && parsed.plan) {
    const i = ensure();
    const existing = messages[i].parts.findIndex((p) => p.type === 'plan');
    const planPart = { type: 'plan' as const, entries: parsed.plan };
    if (existing >= 0) {
      const parts = [...messages[i].parts];
      parts[existing] = planPart;
      messages[i] = { ...messages[i], parts };
    } else {
      messages[i] = { ...messages[i], parts: [...messages[i].parts, planPart] };
    }
    return { idx: i };
  }

  // ─── text / thought: streaming chunk merge ──────────────────────
  // Consecutive chunks of the SAME kind merge into one part (one
  // bubble visually). Different kinds → separate parts.
  if ((parsed.kind === 'text' || parsed.kind === 'thought') && typeof parsed.text === 'string') {
    const i = ensure();
    const partType = parsed.kind;
    const last = messages[i].parts[messages[i].parts.length - 1];
    if (last && last.type === partType) {
      const merged = mergeStreamingText(last.text, parsed.text);
      messages[i] = {
        ...messages[i],
        parts: [
          ...messages[i].parts.slice(0, -1),
          { type: partType, text: merged } as ByoMessage['parts'][number],
        ],
      };
    } else {
      messages[i] = {
        ...messages[i],
        parts: [...messages[i].parts, { type: partType, text: parsed.text } as ByoMessage['parts'][number]],
      };
    }
    return { idx: i };
  }

  // ─── tool_call (initial + updates): merge by toolCallId ─────────
  if (parsed.kind === 'tool_call' && parsed.tool) {
    const i = ensure();
    const inc = parsed.tool;
    const partIdx = messages[i].parts.findIndex(
      (p) => p.type === 'tool_call' && p.toolCallId === inc.toolCallId,
    );
    if (partIdx >= 0) {
      // Merge into existing — only overwrite fields whose incoming
      // value is non-null/non-undefined (per ACP spec).
      const prev = messages[i].parts[partIdx] as AcpToolCallPart;
      const next: AcpToolCallPart = { ...prev };
      if (inc.title !== undefined) next.title = inc.title;
      if (inc.kind !== undefined) next.kind = inc.kind;
      if (inc.status !== undefined) next.status = inc.status;
      if (inc.toolName !== undefined) next.toolName = inc.toolName;
      // rawInput: prefer non-empty later value. The skeleton frame
      // sends `{}` then the filled frame sends `{command,...}`; we
      // want the filled one. Empty object → keep previous if previous
      // had real content.
      if (inc.rawInput !== undefined) {
        const incEmpty = isEmptyObject(inc.rawInput);
        const prevHasContent = !isEmptyObject(prev.rawInput);
        if (!(incEmpty && prevHasContent)) next.rawInput = inc.rawInput;
      }
      if (inc.rawOutput !== undefined) next.rawOutput = inc.rawOutput;
      // content[]: replace per ACP spec ("Replace the content collection").
      if (inc.content !== undefined) next.content = inc.content;
      const parts = [...messages[i].parts];
      parts[partIdx] = next;
      messages[i] = { ...messages[i], parts };
      return { idx: i };
    }
    // New tool call.
    messages[i] = {
      ...messages[i],
      parts: [...messages[i].parts, { type: 'tool_call', ...inc } as AcpToolCallPart],
    };
    return { idx: i };
  }

  // Raw fallback — keep the event so debugging is possible without
  // losing data.
  const i = ensure();
  messages[i] = {
    ...messages[i],
    parts: [...messages[i].parts, { type: 'raw_event', event }],
  };
  return { idx: i };
}

// ─── helpers ────────────────────────────────────────────────────────

function isEmptyObject(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  return Object.keys(v as Record<string, unknown>).length === 0;
}

/**
 * Streaming text dedup. claude-code-acp's text stream contract:
 *   • Most chunks are pure deltas — plain append is correct.
 *   • Occasionally a "settled" snapshot frame arrives carrying the
 *     full message; without dedup we'd render it twice.
 *   • Sometimes the model rewords earlier text mid-stream and emits a
 *     snapshot that doesn't strictly prefix-match the accumulator.
 *
 * Strategy (tuned against real wire dumps):
 *   1. Strict prefix → snapshot, replace.
 *   2. accumulated ends with full incoming → already there, no-op.
 *   3. incoming is longer AND first SNAPSHOT_HEAD_PROBE chars match →
 *      treat as rewording snapshot, replace.
 *   4. Suffix/prefix overlap ≥ MIN_OVERLAP chars → append the
 *      non-overlapping suffix. Floor avoids spurious 1–2-char punctuation
 *      matches that produced duplicated paragraphs in an earlier rev.
 *   5. None of the above → plain append.
 */
const MIN_OVERLAP = 8;
const SNAPSHOT_HEAD_PROBE = 16;

export function mergeStreamingText(accumulated: string, incoming: string): string {
  if (!accumulated) return incoming;
  if (!incoming) return accumulated;
  if (incoming === accumulated) return accumulated;
  if (incoming.startsWith(accumulated)) return incoming;
  if (accumulated.endsWith(incoming)) return accumulated;
  if (incoming.length >= accumulated.length) {
    const head = Math.min(SNAPSHOT_HEAD_PROBE, accumulated.length);
    if (head > 0 && incoming.slice(0, head) === accumulated.slice(0, head)) {
      return incoming;
    }
  }
  const maxOverlap = Math.min(accumulated.length, incoming.length);
  for (let k = maxOverlap; k >= MIN_OVERLAP; k--) {
    if (accumulated.endsWith(incoming.slice(0, k))) return accumulated + incoming.slice(k);
  }
  return accumulated + incoming;
}
