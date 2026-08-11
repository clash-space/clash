import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const entrypoint = readFileSync(join(__dirname, "index.ts"), "utf8");

/**
 * A failure the CLI can explain should not arrive as a Node stack.
 *
 * Nothing caught anything at the top level, so every failure — a stopped host, a rejected key, a
 * conflict the host reported in words — printed `throw new Error(` with a caret, the message, and a
 * dozen frames of bundled JavaScript. The message was there, buried in the middle, looking like the
 * CLI had crashed rather than like something needed doing.
 *
 * Commander's actions are async, so a rejection escapes as an unhandled promise rejection rather
 * than through a try around parse. Both paths need covering.
 */
describe("the entrypoint reports failures as messages", () => {
  it("handles a rejected command action", () => {
    expect(entrypoint).toMatch(/unhandledRejection|\.parseAsync\([\s\S]{0,200}catch/);
  });

  it("exits non-zero, so a script can tell", () => {
    expect(entrypoint).toMatch(/exitCode\s*=\s*1|process\.exit\(1\)/);
  });

  it("keeps the stack reachable for a real bug", () => {
    // A message is right for a condition the CLI understands; an unexpected error still needs its
    // frames, and hiding those would trade one bad debugging experience for another.
    expect(entrypoint).toMatch(/CLASH_DEBUG|DEBUG|stack/);
  });
});
