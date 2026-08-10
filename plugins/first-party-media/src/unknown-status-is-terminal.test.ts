import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const executors = readdirSync(__dirname).filter((f) => f.endsWith("-executor.ts"));

/**
 * No executor may wait on a status it cannot place.
 *
 * Written as `status !== "COMPLETED"` the check reads as careful, and it is the one mistake in
 * polling that produces no symptom. Everything the provider might say other than the single word
 * this executor knows -- a state added upstream, a spelling that differs between model families, a
 * terminal failure phrased unfamiliarly -- becomes another poll, forever, on work that may already
 * have died. The node sits at generating and nothing happens.
 *
 * Deciding this cannot be lifted into a shared table: a status is rarely one flat word. Hub reports
 * message="success" on the envelope while the task underneath failed, MiniMax carries a second
 * verdict in base_resp.status_code, and Vertex returns failures as HTTP 200. So each executor
 * decides, and what is required of all of them is the direction: an unfamiliar status ends the
 * wait.
 */
describe("an unrecognised provider status is terminal", () => {
  for (const file of executors) {
    const source = readFileSync(join(__dirname, file), "utf8");

    it(`${file} accepts only states it named`, () => {
      // The distinction is which side of the comparison the accept sits on. Returning `accepted`
      // under a positive test ("this is one of the running states") bounds it to what the author
      // considered; returning it under a negative test ("this is not the finished state") hands it
      // every word nobody has thought about yet.
      const fallthrough = /if\s*\(\s*(?:!\w+(?:\.\w+)*(?:\([^)]*\))?|[\w.]+\s*!==\s*["'][^"']+["'])\s*\)\s*\{?\s*(?:\/\/[^\n]*\n\s*)*return\s*\{\s*status:\s*"accepted"/;
      expect(source).not.toMatch(fallthrough);
    });
  }
});
