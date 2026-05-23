/**
 * UI-side types for GroupChatPanel and its subcomponents.
 *
 * Distinct from `_group-chat/types.ts` (which holds the runtime/session
 * primitives shared with useGroupChat) so the panel split doesn't get
 * tangled with the hook layer.
 */

export interface CrewRow {
  /** crew_member.id — the row identifier in D1, also the routing key for
   *  room mentions. */
  id: string;
  template_id: string;
  runtime_id: string;
  display_name: string;
  runtime_label: string | null;
  runtime_status: string | null;
}

/** Lowercase, dash-joined version of display_name — what users type after
 *  `@`. Single source of truth so MentionAutocomplete, InviteCrewMenu, and
 *  the panel's resolveMention all agree on the canonical form. */
export function crewHandle(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Up-to-two letter avatar fallback, word-first-letter style.
 * "Canvas Editor" → "CE", "director" → "D", "x" → "X".
 * Matches the rule used by UserControls so the same person/crew shows the
 * same monogram across the app.
 */
export function crewInitials(displayName: string): string {
  const words = displayName
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
