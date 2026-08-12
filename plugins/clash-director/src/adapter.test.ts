import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type {
  ProjectHostClient,
  ProjectHostRequest,
  ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";

function hostClient(
  calls: ProjectHostRequest[],
  respond: (request: ProjectHostRequest) => ProjectHostResponse,
): ProjectHostClient {
  return {
    resolveContext: async ({ projectId, cwd } = {}) => ({
      projectId: projectId ?? "project-marker",
      source: projectId ? "explicit" : "marker",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request<T extends ProjectHostResponse>(request: ProjectHostRequest<T>) {
      calls.push(request);
      return { projectId: request.projectId ?? "project-marker", value: respond(request) as T };
    },
  };
}

const state = {
  schemaVersion: 1,
  scene: { backgroundColor: "#171816", grid: { visible: true, snap: false, size: 1 } },
  objects: [],
  cameras: [],
  shots: [],
};
const stage = {
  id: "stage-1",
  name: "Blocking",
  revisionId: "revision-1",
  owner: { kind: "project" },
  state,
};

test("Director list receipt is supplied to a direct full-state host save", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const writes: Array<{ path: string; content: string | Uint8Array }> = [];
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_director_stages"
      ? { stages: [stage], versions: { "stage-1": "director-host-receipt" } }
      : { stage: { ...stage, revisionId: "revision-2" }, readToken: "director-next-receipt" }),
    writeProjection: async (path, content) => { writes.push({ path, content }); },
  });

  await adapter.get({ cwd: "/workspace", stageId: "stage-1" });
  await adapter.save({
    cwd: "/workspace",
    stageId: "stage-1",
    baseRevisionId: "revision-1",
    state,
  });

  assert.equal(writes[0]?.path, join("/workspace", "director-stages", "stage-1.director-stage.json"));
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "list_director_stages" },
    {
      action: "update_director_stage_state",
      stageId: "stage-1",
      state,
      actorClientType: "mcp",
      observedVersion: "director-host-receipt",
      ifMatch: "director-host-receipt",
    },
  ]);
});

test("Director mutation without a host observation fails before writing", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let writes = 0;
  const adapter = createDirectorAdapter({
    client: hostClient(calls, () => ({ stage })),
    writeProjection: async () => { writes += 1; },
  });

  await assert.rejects(
    adapter.save({
      projectId: "project-1",
      stageId: "stage-1",
      baseRevisionId: "revision-1",
      state,
    }),
    /READ_REQUIRED.*clash_director_get/i,
  );
  assert.equal(writes, 0);
  assert.deepEqual(calls, []);
});

test("typed Director object mutation retains the complete object and uses one host update", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const object = {
    id: "key-light",
    name: "Key Light",
    kind: "light",
    visible: false,
    transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] },
    light: { type: "spot", intensity: 7, range: 30, angle: 0.8 },
  };
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_director_stages"
      ? { stages: [stage], versions: { "stage-1": "director-host-receipt" } }
      : { stage: { ...stage, state: { ...state, objects: [object] } } }),
    writeProjection: async () => undefined,
  });

  await adapter.mutate("clash_director_object_add", {
    projectId: "project-1",
    stageId: "stage-1",
    object,
  });

  assert.deepEqual(
    (calls.at(-1)?.command as { state?: { objects?: unknown[] } }).state?.objects,
    [object],
  );
  assert.equal(calls.some(({ command }) => (command as { action?: string }).action === "director_object_add"), false);
});

test("Director capture calls the typed host renderer command directly", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const writes: string[] = [];
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_director_stages"
      ? { stages: [stage], versions: { "stage-1": "director-host-receipt" } }
      : {
          captured: true,
          stageId: "stage-1",
          sourceStageRevisionId: "revision-1",
          renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
          stateSha256: "state-hash",
          frames: [{
            label: "opening",
            timeSeconds: 0,
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            mimeType: "image/png",
            dataBase64: Buffer.from("png").toString("base64"),
            sha256: "frame-hash",
          }],
        }),
    writeProjection: async (path) => { writes.push(path); },
  });

  await adapter.get({ cwd: "/workspace", stageId: "stage-1" });
  const result = await adapter.capture({
    cwd: "/workspace",
    stageId: "stage-1",
    times: [0],
    labels: ["opening"],
    longEdge: 1920,
  });

  assert.deepEqual(calls.at(-1)?.command, {
    action: "capture_director_stage",
    stageId: "stage-1",
    frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "16:9" }],
    longEdge: 1920,
    actorClientType: "mcp",
    observedVersion: "director-host-receipt",
    ifMatch: "director-host-receipt",
  });
  assert.equal((result as { stageId?: string }).stageId, "stage-1");
  assert.ok(writes.some((path) => path.endsWith("opening.png")));
  assert.ok(writes.some((path) => path.endsWith("capture.json")));
});
