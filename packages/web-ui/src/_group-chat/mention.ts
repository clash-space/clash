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
 * Convention split (per user direction): `@` always means "address a
 * crew member", `#` means "attach a canvas node". The attachment
 * picker (MilkdownEditor) uses `#`, so the two never collide.
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
