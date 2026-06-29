import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCanvasPresenceOptions, resolveCanvasProjectId } from "./canvas";
import { initProject } from "./projects";

test("marks spawned agent canvas sync as agent presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({
    CLASH_AGENT_MEMBER_ID: "local-master-clash",
  }), {
    clientType: "agent",
    agentName: "local-master-clash",
  });
});

test("keeps human CLI canvas sync as cli presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({}), {
    clientType: "cli",
  });
});

test("resolves canvas project from clash init marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "clash-canvas-project-"));
  const { projectId } = await initProject({ cwd: root, projectId: "proj_marker_canvas" });

  assert.equal(await resolveCanvasProjectId({ cwd: root, env: {} }), projectId);
});
