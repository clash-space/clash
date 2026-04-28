/**
 * Tiny ANSI styling + logo banner.
 *
 * No deps (chalk would pull in ~100KB for what amounts to 12 escape codes).
 * Auto-disables color when stderr isn't a TTY (so the launchd log file
 * doesn't get filled with garbage like `[1m` everywhere).
 */

const isTty = !!process.stderr.isTTY && !process.env.NO_COLOR;

function wrap(open: string, close: string) {
  return (s: string) => (isTty ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const c = {
  bold:    wrap("1",  "22"),
  dim:     wrap("2",  "22"),
  red:     wrap("31", "39"),
  green:   wrap("32", "39"),
  yellow:  wrap("33", "39"),
  blue:    wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan:    wrap("36", "39"),
  gray:    wrap("90", "39"),
};

/**
 * Two-line minimal banner. Block-art "C/" attempts looked like clipart
 * in real terminals (slash too far from the C, glyph weight uneven
 * across fonts). A typographic mark works better at this size — bold
 * "C/" inline with the wordmark, cyan, no multi-line ASCII.
 *
 * Single source of truth for command-startup chrome.
 */
export function printBanner(subtitle: string, version: string): void {
  const mark = c.cyan(c.bold("C/"));
  const word = c.bold("clash bridge");
  const ver = c.dim(`v${version}`);
  process.stderr.write(
    `\n  ${mark}  ${word}  ${ver}\n  ${c.gray(subtitle)}\n\n`,
  );
}

export const sym = {
  ok:    () => c.green("✓"),
  warn:  () => c.yellow("!"),
  err:   () => c.red("✗"),
  arrow: () => c.cyan("→"),
  dot:   () => c.gray("·"),
};

/** Stderr writers with the matching prefix symbol. */
export const log = {
  step:  (s: string) => process.stderr.write(`${sym.arrow()} ${s}\n`),
  ok:    (s: string) => process.stderr.write(`${sym.ok()} ${s}\n`),
  warn:  (s: string) => process.stderr.write(`${sym.warn()} ${c.yellow(s)}\n`),
  err:   (s: string) => process.stderr.write(`${sym.err()} ${c.red(s)}\n`),
  hint:  (s: string) => process.stderr.write(`  ${c.gray(s)}\n`),
};
