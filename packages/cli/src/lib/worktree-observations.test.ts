import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  forgetWorktreeObservation,
  readWorktreeObservation,
  recordWorktreeObservation,
  requireWorktreeObservation,
  worktreeObservationPath,
} from "./worktree-observations";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-observed-"));
}

test("worktree observations persist only project-scoped entity versions", async () => {
  const workspaceRoot = await tempWorkspace();

  await recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
    revision: "node-v1:aaa",
  });
  await recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "timeline",
    entityId: "editor-1",
    revision: "timeline-v1:bbb",
  });

  assert.deepEqual(
    JSON.parse(await readFile(worktreeObservationPath(workspaceRoot), "utf8")),
    {
      schemaVersion: 1,
      projectId: "project-1",
      versions: {
        "canvas-node:node-1": "node-v1:aaa",
        "timeline:editor-1": "timeline-v1:bbb",
      },
    },
  );
  assert.deepEqual(await readdir(join(workspaceRoot, ".clash")), ["observed.json"]);
  assert.equal((await stat(worktreeObservationPath(workspaceRoot))).mode & 0o777, 0o600);
});

test("parallel reads in one cwd preserve every observed entity version", async () => {
  const workspaceRoot = await tempWorkspace();

  await Promise.all(Array.from({ length: 16 }, (_, index) => recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: `node-${index}`,
    revision: `node-v1:${index}`,
  })));

  assert.deepEqual(
    JSON.parse(await readFile(worktreeObservationPath(workspaceRoot), "utf8")),
    {
      schemaVersion: 1,
      projectId: "project-1",
      versions: Object.fromEntries(Array.from(
        { length: 16 },
        (_, index) => [`canvas-node:node-${index}`, `node-v1:${index}`],
      )),
    },
  );
  assert.deepEqual(await readdir(join(workspaceRoot, ".clash")), ["observed.json"]);
});

test("worktree observations do not reuse versions after the cwd is linked to another project", async () => {
  const workspaceRoot = await tempWorkspace();
  await recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "text",
    entityId: "script-1",
    revision: "text-v1:old",
  });

  assert.equal(await readWorktreeObservation({
    workspaceRoot,
    projectId: "project-2",
    entityKind: "text",
    entityId: "script-1",
  }), undefined);

  await recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-2",
    entityKind: "text",
    entityId: "script-2",
    revision: "text-v1:new",
  });

  assert.deepEqual(
    JSON.parse(await readFile(worktreeObservationPath(workspaceRoot), "utf8")),
    {
      schemaVersion: 1,
      projectId: "project-2",
      versions: { "text:script-2": "text-v1:new" },
    },
  );
});

test("worktree observation checks distinguish unread entities and can forget deleted entities", async () => {
  const workspaceRoot = await tempWorkspace();
  const unread = await requireWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
  });
  assert.deepEqual(unread, {
    ok: false,
    code: "READ_REQUIRED",
    error: "Read canvas-node node-1 before writing.",
  });

  await recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
    revision: "node-v1:aaa",
  });
  assert.deepEqual(await requireWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
  }), { ok: true, revision: "node-v1:aaa" });

  await forgetWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
  });
  assert.equal(await readWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
  }), undefined);
});

test("worktree observations reject a .clash symlink that escapes the cwd", async () => {
  const workspaceRoot = await tempWorkspace();
  const outside = await mkdtemp(join(tmpdir(), "clash-observed-outside-"));
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(workspaceRoot, ".clash"));

  await assert.rejects(recordWorktreeObservation({
    workspaceRoot,
    projectId: "project-1",
    entityKind: "canvas-node",
    entityId: "node-1",
    revision: "node-v1:aaa",
  }), /must not traverse a symlink outside/);
  await assert.rejects(readFile(join(outside, "observed.json"), "utf8"), /ENOENT/);
});
