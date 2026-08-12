import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Payload size picks the transport, never the guarantee.
 *
 * `update` exists because a small payload fits in one command; `pull`/`apply`
 * exists because a large one does not. Both are mutations of the same entity, so
 * both perform read-presence verification and CAS. A caller must not be able to
 * pick a weaker contract by picking a transport.
 */

const canvasSource = readFileSync(
  fileURLToPath(new URL("./canvas.ts", import.meta.url)),
  "utf8",
);
const textSource = readFileSync(
  fileURLToPath(new URL("./text.ts", import.meta.url)),
  "utf8",
);
const projectionSource = readFileSync(
  fileURLToPath(new URL("./projection.ts", import.meta.url)),
  "utf8",
);
const projectHostSource = readFileSync(
  fileURLToPath(
    new URL("../../../../apps/local-api/src/project-command-host.ts", import.meta.url),
  ),
  "utf8",
);

test("observation record and require are not gated on the client being agent-tagged", () => {
  // An observation is concurrency evidence, not a permission. Gating it on the
  // client label made CAS opt-out: a cli-tagged caller silently skipped it.
  for (const [name, source] of [["canvas", canvasSource], ["text", textSource]] as const) {
    assert.doesNotMatch(
      source,
      /if \(agentClientType\(\) !== "agent"\) return/,
      `${name} must not skip observations for non-agent clients`,
    );
    assert.doesNotMatch(
      source,
      /if \(!isAgentTextClient\(\)\) return/,
      `${name} must not skip observations for non-agent clients`,
    );
  }
});

test("every transport requires proof of read before mutating", () => {
  assert.match(canvasSource, /requireCanvasObservation/);
  assert.match(textSource, /requireTextObservation/);
  assert.match(projectionSource, /requireProjectionObservation/);
});

test("the local-api host compares forwarded text read proof", () => {
  assert.match(textSource, /ifMatch: cas\.observedVersion/);
  assert.match(projectHostSource, /case "text_cas_update"/);
  assert.match(projectHostSource, /validateAgentReadProof/);
  assert.match(projectHostSource, /currentReadToken: beforeReadToken/);
});

test("no transport offers a force or bypass flag", () => {
  for (const [name, source] of [
    ["canvas", canvasSource],
    ["text", textSource],
    ["projection", projectionSource],
  ] as const) {
    assert.doesNotMatch(source, /--force|--if-match|--no-cas/, `${name} must not offer a CAS bypass`);
  }
});

test("one entity has exactly one observation ledger, whatever the transport", async () => {
  // Two ledgers for the same node means a write through one transport does not
  // invalidate a read recorded by the other, so switching transport becomes a
  // stale-write bypass.
  const { projectionObservationEntityKind } = await import("../lib/projection-kinds");

  assert.equal(projectionObservationEntityKind("text"), "canvas-node");
  assert.equal(projectionObservationEntityKind("component"), "canvas-node");
  assert.equal(projectionObservationEntityKind("timeline"), "timeline");
  assert.equal(projectionObservationEntityKind("stage"), "director-stage");

  // The text command must book against the entity, not against its own name.
  assert.doesNotMatch(textSource, /entityKind: "text"/);
  assert.match(textSource, /entityKind: "canvas-node"/);
});
