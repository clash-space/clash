import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeProjectMarker } from "./project-context";
import {
  forgetAgentObservation,
  publicAgentCommandResult,
  recordAgentObservation,
  requireAgentObservation,
} from "./agent-worktree-observation";

test("agent command observations keep opaque host receipts without exposing them in command output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-agent-observation-"));
  await writeProjectMarker(cwd, { schemaVersion: 1, projectId: "project-1" });
  const env = { CLASH_AGENT_MEMBER_ID: "agent-1" };

  await recordAgentObservation({
    cwd,
    env,
    entityKind: "asset",
    entityId: "asset-1",
    revision: "asset-v1:abc:receipt:host-secret",
  });
  assert.equal(await requireAgentObservation({
    cwd,
    env,
    entityKind: "asset",
    entityId: "asset-1",
  }), "asset-v1:abc:receipt:host-secret");

  const state = JSON.parse(await readFile(join(cwd, ".clash", "observed.json"), "utf8"));
  assert.deepEqual(state.versions, {
    "asset:asset-1": "asset-v1:abc:receipt:host-secret",
  });

  await forgetAgentObservation({ cwd, env, entityKind: "asset", entityId: "asset-1" });
  await assert.rejects(
    requireAgentObservation({ cwd, env, entityKind: "asset", entityId: "asset-1" }),
    /READ_REQUIRED/,
  );
});

test("human commands do not require a project observation workspace", async () => {
  assert.equal(await requireAgentObservation({
    cwd: "/path/that/does/not/exist",
    env: {},
    entityKind: "asset",
    entityId: "asset-1",
  }), undefined);
});

test("public agent command results hide internal versions and receipts", () => {
  assert.deepEqual(publicAgentCommandResult({
    updated: true,
    version: "node-v1:new",
    readToken: "node-v1:new:receipt:secret",
    node: { data: { version: "user-content-version" } },
    replaceResult: {
      version: "node-v1:copy",
      readToken: "node-v1:copy:receipt:secret",
      copied: true,
    },
    mutation: {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "node-1" },
      expectedHash: "node-v1:old",
      beforeHash: "node-v1:old",
      afterHash: "node-v1:new",
      expectedReadToken: "old:receipt:secret",
      beforeReadToken: "old",
      afterReadToken: "new:receipt:secret",
      accepted: true,
    },
  }), {
    updated: true,
    node: { data: { version: "user-content-version" } },
    replaceResult: { copied: true },
    mutation: {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "node-1" },
      accepted: true,
    },
  });
});
