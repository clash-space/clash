import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recoverStaleProjection,
  staleProjectionRecoveryError,
} from "./stale-projection-recovery";
import { readWorktreeObservation } from "./worktree-observations";

test("stale recovery preserves the edited projection and pulls the latest host state beside a durable receipt", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "clash-stale-recovery-"));
  const editedProjectionPath = join(workspaceRoot, "timelines", "rough-cut.timeline.yaml");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(workspaceRoot, "timelines"), { recursive: true });
  await writeFile(editedProjectionPath, "tracks:\n  - id: my-local-edit\n", "utf8");

  const recovery = await recoverStaleProjection({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "timeline",
    entityId: "rough-cut",
    currentRevisionId: "revision-2",
    currentObservation: "timeline-v1:latest:receipt:signed",
    editedProjectionPath,
    latestContent: "tracks:\n  - id: concurrent-host-edit\n",
  });

  assert.deepEqual(recovery, {
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
  });
  assert.equal(
    await readFile(editedProjectionPath, "utf8"),
    "tracks:\n  - id: my-local-edit\n",
  );
  assert.equal(
    await readFile(join(workspaceRoot, recovery.latestProjectionPath), "utf8"),
    "tracks:\n  - id: concurrent-host-edit\n",
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(workspaceRoot, recovery.recoveryReceiptPath), "utf8")),
    recovery,
  );
  assert.equal(await readWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "timeline",
    entityId: "rough-cut",
  }), "timeline-v1:latest:receipt:signed");

  const error = staleProjectionRecoveryError("Timeline", recovery);
  assert.match(error.message, /STALE_READ/);
  assert.match(error.message, /revision-2/);
  assert.match(error.message, /\.clash\/recovery\/timeline\/rough-cut\.latest\.timeline\.yaml/);
  assert.match(error.message, /timelines\/rough-cut\.timeline\.yaml/);
  assert.match(error.message, /merge.*retry/i);
  assert.match(error.message, /did not apply or resubmit/i);
});

test("Director stale recovery uses the same primitive with a deterministic JSON projection path", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "clash-director-recovery-"));
  const editedProjectionPath = join(workspaceRoot, "director-stages", "stage-1.director-stage.json");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(workspaceRoot, "director-stages"), { recursive: true });
  await writeFile(editedProjectionPath, "{\"local\":true}\n", "utf8");

  const recovery = await recoverStaleProjection({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "director-stage",
    entityId: "stage-1",
    currentRevisionId: "stage-revision-3",
    currentObservation: "director-stage-v1:latest:receipt:signed",
    editedProjectionPath,
    latestContent: "{\"host\":true}\n",
  });

  assert.equal(
    recovery.latestProjectionPath,
    ".clash/recovery/director-stage/stage-1.latest.director-stage.json",
  );
  assert.equal(await readFile(editedProjectionPath, "utf8"), "{\"local\":true}\n");
});
