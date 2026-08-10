import test from "node:test";
import assert from "node:assert/strict";

import { requireCurrentTextVersion, textReadToken } from "../lib/text-projection";

/**
 * The direct-replica write path used to forward `observedVersion` to the daemon
 * and, when no daemon was running, drop it entirely -- so `text apply` and
 * `projection apply` accepted stale writes whenever the daemon was down. This
 * locks the comparison itself.
 */

const projectId = "project-1";
const nodeId = "node-1";

test("a write naming the current version is allowed", () => {
  const current = "line one\n";
  assert.doesNotThrow(() =>
    requireCurrentTextVersion({
      observedVersion: textReadToken({ projectId, nodeId, content: current }),
      projectId,
      nodeId,
      currentContent: current,
    }),
  );
});

test("a write naming a superseded version is refused", () => {
  const observed = textReadToken({ projectId, nodeId, content: "line one\n" });
  assert.throws(
    () =>
      requireCurrentTextVersion({
        observedVersion: observed,
        projectId,
        nodeId,
        currentContent: "line one, edited by someone else\n",
      }),
    /STALE_READ/,
  );
});

test("the host read token wins over the recomputed one when present", () => {
  // A host-issued token is authoritative; content hashing is only the fallback.
  assert.doesNotThrow(() =>
    requireCurrentTextVersion({
      observedVersion: "host-token-abc",
      projectId,
      nodeId,
      currentContent: "anything at all",
      currentReadToken: "host-token-abc",
    }),
  );
  assert.throws(
    () =>
      requireCurrentTextVersion({
        observedVersion: "host-token-abc",
        projectId,
        nodeId,
        currentContent: "anything at all",
        currentReadToken: "host-token-def",
      }),
    /STALE_READ/,
  );
});

test("an absent observed version is the caller's policy, not a failure here", () => {
  // A small direct write may skip proof of read; this helper only compares.
  // The agent gate and the projection loop are what demand proof.
  assert.doesNotThrow(() =>
    requireCurrentTextVersion({
      observedVersion: undefined,
      projectId,
      nodeId,
      currentContent: "x",
    }),
  );
});
