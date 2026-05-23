/**
 * Crew mention parser. Extracts the addressee from a user prompt so
 * the GroupChat can route it. The match is greedy on the first @<id>
 * token at the start of the input, optionally trimmed of leading
 * whitespace.
 *
 *   "@director plan a 5s clip"  →  { crewId: "director", body: "plan a 5s clip" }
 *   "  @canvas-editor add node" →  { crewId: "canvas-editor", body: "add node" }
 *   "hi"                        →  { crewId: null, body: "hi" }
 *
 * The MilkdownEditor's `@` picker emits the canonical
 * `@[label](node:<id>)` markdown form for *every* selection (crew or
 * canvas). The submit handler in GroupChatPanel partitions those by
 * checking each id against `invitedCrewIdSet`. This regex is the
 * fallback path for plain-text `@<id>` that a user types manually
 * (no picker), which the rest of the room dispatcher still honors.
 *
 * Crew ids only allow lowercase letters, digits, hyphens (matches the
 * bundled crew slugs and any future user-defined ids that go through
 * the same id-sanitizer).
 */

const MENTION_RE = /^\s*@([a-z0-9][a-z0-9-]*)\b\s*/i;

export interface ParsedMention {
  crewId: string | null;
  body: string;
}

export function parseMention(text: string): ParsedMention {
  const m = MENTION_RE.exec(text);
  if (!m) return { crewId: null, body: text };
  return {
    crewId: m[1].toLowerCase(),
    body: text.slice(m[0].length),
  };
}
