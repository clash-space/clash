/**
 * @-mention autocomplete state machine for the chat composer.
 *
 * Detects when the cursor sits right after a fresh `@<query>` token (no
 * intervening space) and exposes:
 *   - open / matches / activeIndex for the popover JSX
 *   - onDraftChange to plug into the textarea's onChange
 *   - onKeyDown to plug into the textarea's onKeyDown (handles Up/Down/Enter/Tab/Esc)
 *   - insertMention(row) to commit a selection (called from popover click)
 *
 * Cursor placement after insertion uses requestAnimationFrame instead of
 * queueMicrotask: the microtask runs BEFORE React commits the new
 * draft, so setSelectionRange would then operate against the still-old
 * DOM value and place the cursor wrong (then the user types and the
 * insertion appears in the middle of nowhere). rAF runs after commit
 * — DOM and React state are aligned.
 */

import { useCallback, useId, useMemo, useState } from 'react';
import { agentHandle, type AgentRow } from '../_group-chat/panel-types';

export interface UseMentionAutocompleteResult<R extends AgentRow> {
  open: boolean;
  matches: R[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  close: () => void;
  /** Pass to <textarea onChange={...}>. Updates the draft AND re-evaluates
   *  the autocomplete state from the event (NOT from closure-captured
   *  draft, which is still stale at this point). */
  onDraftChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Pass to <textarea onKeyDown={...}>. Returns true if the event was
   *  consumed by the autocomplete (so the caller can skip Enter→send /
   *  Tab→indent etc). */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Commit a selection — typically called from the popover's onMouseDown. */
  insertMention: (row: R) => void;
  /** Stable id for the popover's <ul role="listbox">. Use for textarea's
   *  `aria-controls` when `open` is true. */
  listboxId: string;
  /** Build the id for an option row at `idx`. Use the entry at
   *  `activeIndex` for textarea's `aria-activedescendant` (AT then
   *  announces the focused row as the user arrows through). */
  optionId: (idx: number) => string;
}

export function useMentionAutocomplete<R extends AgentRow>(
  draft: string,
  setDraft: (next: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  candidates: R[],
): UseMentionAutocompleteResult<R> {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const optionId = useCallback((idx: number) => `${listboxId}-opt-${idx}`, [listboxId]);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    return candidates.filter((c) => {
      const handle = agentHandle(c.display_name);
      // Prefix match wins; substring as fallback so longer agent names
      // (e.g. "canvas-editor") still surface when the user types "edit".
      return handle.startsWith(q) || c.template_id.startsWith(q) || handle.includes(q);
    });
  }, [open, query, candidates]);

  const close = useCallback(() => setOpen(false), []);

  const onDraftChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      const pos = e.target.selectionStart ?? next.length;
      setDraft(next);
      const before = next.slice(0, pos);
      const m = before.match(/(?:^|\s)@([a-z0-9-]*)$/i);
      if (m) {
        setOpen(true);
        setQuery(m[1] ?? '');
        setActiveIndex(0);
      } else {
        setOpen(false);
      }
    },
    [setDraft],
  );

  /** Locate the @<query> partial token before the cursor. Returns the
   *  start position of the @ in the original string, or null. */
  const partial = useCallback((): { start: number; cursor: number } | null => {
    const ta = textareaRef.current;
    if (!ta) return null;
    const cursor = ta.selectionStart ?? 0;
    const before = draft.slice(0, cursor);
    const m = before.match(/(?:^|\s)@([a-z0-9-]*)$/i);
    if (!m) return null;
    // m[0] starts with @ when matched at string start, with a space when
    // matched mid-string. Either way, the @ position = cursor - (length
    // after the leading space).
    const matched = m[0];
    const start = cursor - matched.length + (matched.startsWith('@') ? 0 : 1);
    return { start, cursor };
  }, [draft, textareaRef]);

  const insertMention = useCallback(
    (row: R) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const p = partial();
      if (!p) return;
      const inserted = `@${agentHandle(row.display_name)} `;
      const before = draft.slice(0, p.start);
      const after = draft.slice(p.cursor);
      const next = before + inserted + after;
      setDraft(next);
      setOpen(false);
      // rAF, not queueMicrotask: lets React commit the new value to the
      // DOM before we set selection range, otherwise we'd be selecting
      // against the stale string.
      const newPos = (before + inserted).length;
      requestAnimationFrame(() => {
        const liveTa = textareaRef.current;
        if (!liveTa) return;
        liveTa.focus();
        liveTa.setSelectionRange(newPos, newPos);
      });
    },
    [draft, setDraft, textareaRef, partial],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || matches.length === 0) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(matches[activeIndex]);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return true;
      }
      return false;
    },
    [open, matches, activeIndex, insertMention],
  );

  return {
    open,
    matches,
    activeIndex,
    setActiveIndex,
    close,
    onDraftChange,
    onKeyDown,
    insertMention,
    listboxId,
    optionId,
  };
}
