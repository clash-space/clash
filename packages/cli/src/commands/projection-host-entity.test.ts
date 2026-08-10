import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const projection = readFileSync(join(__dirname, "projection.ts"), "utf8");

/**
 * `projection pull/apply` serves every declared kind, including host entities.
 *
 * Pull and apply are the same interaction for every projectable entity: write the file, edit it
 * with normal tools, write it back under CAS. Only three facts differ per kind -- where the file
 * lives, what it is called, and which contract describes it -- and those are already declared in
 * the projection-kind table.
 *
 * Today the generic command lists `timeline` and `director-stage` in `projection kinds` and then
 * refuses to act on them, pointing at per-entity commands instead:
 *
 *   Kind timeline is a timeline entity; use `clash timeline pull/apply` ...
 *
 * That is the worst arrangement available: one vocabulary advertises the entity, another one
 * operates it, and an agent that discovered the kind through `projection kinds` cannot use it.
 *
 * The per-entity commands do not all collapse. `create`, `attach`, `render`, and `capture` are
 * entity lifecycle, not projection, and belong to whichever plugin owns the entity.
 */
test("pull and apply accept every declared kind", () => {
  assert.doesNotMatch(
    projection,
    /requireCanvasNodeKind/,
    "no kind may be refused for being a host entity",
  );
});

test("host-entity projections are read and written through the host", () => {
  // A plugin picks an existing source shape; the host owns the read, the write, and the CAS rule
  // over the entity, which is why `source` is a closed set rather than a callback.
  assert.match(projection, /host-entity/);
});

test("the redirect message is gone", () => {
  assert.doesNotMatch(projection, /use \\`clash \$\{/);
  assert.doesNotMatch(projection, /lifecycle-bearing commands/);
});
