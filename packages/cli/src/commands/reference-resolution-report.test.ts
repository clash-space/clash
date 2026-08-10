import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * An unresolved reference must be reported in JSON mode too.
 *
 * `canvas add` warns on stderr when a `@[label](node:id)` mention names nothing, but the warning was
 * gated on `!isJsonMode(options)`. Agents and scripts always pass `--json`, so for them the mention
 * silently vanished: the node was created with no ref edges, and the failure only appeared later as a
 * capability complaint from the model card,
 *
 *   Selected model needs a start frame. Attach one via @-mention in the prompt.
 *
 * which points at the prompt the user did write. Suppressing diagnostics for the machine-readable
 * caller is backwards -- that is the caller that cannot see stderr scrollback.
 */
describe("canvas add reports unresolved references in every mode", () => {
  const source = readFileSync(
    join(__dirname, "canvas.ts"),
    "utf8",
  );

  it("does not gate the unresolved-reference warning on human output", () => {
    expect(source).not.toContain("resolved.missing.length > 0 && !isJsonMode(options)");
  });

  it("carries unresolved references in the JSON payload", () => {
    // A machine caller needs the fact in the document it parses, not on a stream it discards.
    expect(source).toMatch(/unresolvedReferences/);
  });
});
