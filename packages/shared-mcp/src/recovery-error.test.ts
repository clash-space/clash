import test from "node:test";
import assert from "node:assert/strict";

import { parseClashRecoveryError } from "./recovery-error.js";

test("parses one CLI stale-recovery marker into clean MCP text and structured merge metadata", () => {
  const recovery = {
    schemaVersion: 1,
    code: "STALE_READ",
    entityKind: "timeline",
    entityId: "rough-cut",
    currentRevisionId: "revision-2",
    editedProjectionPath: "timelines/rough-cut.timeline.yaml",
    latestProjectionPath: ".clash/recovery/timeline/rough-cut.latest.timeline.yaml",
    recoveryReceiptPath: ".clash/recovery/timeline/rough-cut.recovery.json",
    next: "Merge the edited projection into the latest projection, then retry the apply command.",
    resubmitted: false,
  };

  assert.deepEqual(parseClashRecoveryError([
    "Command failed: clash timeline apply --json",
    `Error: STALE_READ: latest pulled. CLASH_RECOVERY=${JSON.stringify(recovery)}`,
    "    at Command.<anonymous> (/private/tmp/runtime.cjs:10:2)",
  ].join("\n")), {
    message: "STALE_READ: latest pulled.",
    recovery,
  });
});

test("keeps ordinary tool errors unchanged", () => {
  assert.deepEqual(parseClashRecoveryError(
    "Command failed\nError: TIMELINE_DSL_INVALID: bad track\n at stack",
  ), {
    message: "TIMELINE_DSL_INVALID: bad track",
  });
});
