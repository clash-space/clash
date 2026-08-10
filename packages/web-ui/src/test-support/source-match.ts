/**
 * Whitespace-insensitive source assertions.
 *
 * A number of suites lock architecture by asserting that a component's source
 * contains a specific expression. The intent is "this mechanism exists", but the
 * literal form also encodes Prettier's line breaks, so a pure reformat -- a JSX
 * prop pushed onto its own line, a call's arguments wrapped -- reported a failure
 * with no behaviour change at all.
 *
 * Normalizing collapses runs of whitespace and drops the spaces Prettier inserts
 * around punctuation, so the assertion survives reflow while still failing when
 * the mechanism is actually gone.
 *
 * Quote style is normalized for the same reason. Prettier picks the delimiter, so a
 * suite asserting `import { Toolbar } from 'radix-ui'` failed against a source that
 * spelled the identical import with double quotes. Only the delimiters are rewritten
 * and only when the quoted run contains no quote of the other kind, so a literal that
 * carries an apostrophe or a nested quote keeps its exact contents.
 */

/**
 * Normalization, in one pass shared by the source and any pattern.
 *
 * Only whitespace that Prettier *introduced* is folded. An earlier version collapsed
 * every space after `(`, `{`, or `,`, which quietly rewrote ordinary single spaces:
 * `initial={{ opacity: 0, scale: 0.86 }}` became `initial={{opacity: 0,scale: 0.86}}`,
 * so a pattern copied verbatim from the source could not match it. Line breaks are
 * marked first, and only a mark adjacent to punctuation disappears.
 */

/**
 * Reduce both sides to one bracket-tight form.
 *
 * Which canonical spelling gets chosen does not matter; what matters is that the
 * source and the pattern get the *same* one. So all whitespace touching a bracket or
 * a comma is removed, and the rule tolerates the backslash a pattern puts in front of
 * its brackets -- that asymmetry was the actual bug: source `y: 8 }}` collapsed to
 * `8}}` while pattern `y: 8 \}\}` kept its space, because the space was followed by a
 * backslash rather than a brace.
 */

/** Escaped or bare closing punctuation. */
const CLOSER = String.raw`\\?[)\]};,]|\\?\/?>`;

function normalize(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    // Nothing follows an opening bracket or a comma.
    .replace(/([([{,]) +/gu, "$1")
    // Nothing precedes a closer, escaped or not.
    .replace(new RegExp(` +(?=${CLOSER})`, "gu"), "")
    // Prettier adds a trailing comma when it wraps arguments, so the wrapped and inline
    // forms of one call differ by exactly that comma.
    .replace(/,(?=\\?[)\]}])/gu, "")
    // Prettier chooses the quote delimiter. Only delimiters are rewritten, and only when
    // the quoted run holds no quote of the other kind, so a literal keeps its contents.
    .replace(/(?<!\\)'([^'"\n]*)(?<!\\)'/gu, '"$1"')
    .trim();
}

export function normalizeSource(source: string): string {
  return normalize(source);
}

/** True when `snippet` appears in `source`, ignoring formatting differences. */
export function sourceContains(source: string, snippet: string): boolean {
  return normalizeSource(source).includes(normalizeSource(snippet));
}

/**
 * Apply a pattern to normalized source.
 *
 * The pattern's literal text goes through the same function, because normalizing one
 * side only reintroduces the mismatch this module removes. Regex metacharacters survive,
 * so `\s*` and character classes keep working.
 *
 * Bound every gap. Normalized source is a single line, so `[^\n]*` and `[\s\S]*` stop
 * meaning "nearby" and will happily match across the whole file.
 */
export function sourceMatches(source: string, pattern: RegExp): boolean {
  return new RegExp(normalize(pattern.source), pattern.flags).test(normalizeSource(source));
}
