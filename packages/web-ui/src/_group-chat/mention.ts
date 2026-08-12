/**
 * Agent mention parser. Extracts the addressee from a user prompt so
 * the GroupChat can route it. The match is greedy on the first @<id>
 * token at the start of the input, optionally trimmed of leading
 * whitespace.
 *
 *   "@clash plan a 5s clip" -> { agentMemberId: "clash", body: "plan a 5s clip" }
 *   "  @canvas-editor add node" →  { agentMemberId: "canvas-editor", body: "add node" }
 *   "hi"                        →  { agentMemberId: null, body: "hi" }
 *
 * The MilkdownEditor's `@` picker emits the canonical
 * `@[label](node:<id>)` markdown form for *every* selection (agent or
 * canvas). The submit handler in GroupChatPanel partitions those by
 * checking each id against `invitedAgentIdSet`. This regex is the
 * fallback path for plain-text `@<id>` that a user types manually
 * (no picker), which the rest of the room dispatcher still honors.
 *
 * Agent ids only allow lowercase letters, digits, hyphens (matches the
 * bundled agent slugs and any future user-defined ids that go through
 * the same id-sanitizer).
 */

const MENTION_RE = /^\s*@([a-z0-9][a-z0-9-]*)\b\s*/i;

export interface ParsedMention {
  agentMemberId: string | null;
  body: string;
}

export function parseMention(text: string): ParsedMention {
  const m = MENTION_RE.exec(text);
  if (!m) return { agentMemberId: null, body: text };
  return {
    agentMemberId: m[1].toLowerCase(),
    body: text.slice(m[0].length),
  };
}
