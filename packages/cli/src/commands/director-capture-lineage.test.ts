import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(__dirname, "director.ts"), "utf8");

/**
 * A capture must record what produced it, in the place lineage is kept.
 *
 * Every other produced artefact in the product is a canvas node whose edges name its inputs: an
 * action badge spawns an asset child with reference edges, and a `video-editor` node spawns a
 * pending `render-video` child. A capture writes PNGs into `director-stages/<id>/captures/` and
 * nothing else, so what the image came from survives only as a directory path -- and a path is not
 * a relation. Re-capturing after an edit leaves two files with no way to tell which Stage revision
 * each belongs to.
 *
 * The facts are already collected. `capture.json` carries `stageId`, `sourceStageRevisionId`,
 * `timeSeconds`, and a per-frame `sha256`; they simply never reach the asset system, where lineage
 * is queryable.
 */
test("capture records lineage for each frame it writes", () => {
  assert.match(
    source,
    /captureLineage|recordCaptureLineage/,
    "captures must be registered with their provenance, not only written to disk",
  );
});

test("lineage names the Stage revision the frame was rendered from", () => {
  const lineage = source.slice(source.indexOf("recordCaptureLineage"));
  assert.match(lineage.slice(0, 2000), /sourceStageRevisionId|stageRevisionId/);
  assert.match(lineage.slice(0, 2000), /timeSeconds/);
});
