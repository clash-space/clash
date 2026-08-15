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
  const saved = await adapter.save({
    cwd: "/workspace",
    stageId: "stage-1",
    baseRevisionId: "revision-1",
    state,
  });
  assert.doesNotMatch(
    JSON.stringify(saved),
    /readToken|receipt|ifMatch|observedVersion/i,
  );

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

test("Director full-state save rejects capture outputs before writing or contacting the Host", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let writes = 0;
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_director_stages"
      ? { stages: [stage], versions: { "stage-1": "director-host-receipt" } }
      : { stage }),
    writeProjection: async () => { writes += 1; },
  });
  await adapter.get({ cwd: "/workspace", stageId: "stage-1" });

  await assert.rejects(
    adapter.save({
      cwd: "/workspace",
      stageId: "stage-1",
      baseRevisionId: "revision-1",
      state: {
        ...state,
        cameras: [{
          id: "camera-a",
          name: "Camera A",
          position: [0, 1.6, 6],
          rotation: [0, 0, 0],
          fov: 42,
        }],
        shots: [{
          id: "legacy-capture",
          name: "Legacy capture",
          cameraId: "camera-a",
          assetId: "asset-capture",
          aspectRatio: "16:9",
          stageRevisionId: "legacy-revision",
          createdAt: "2026-08-15T00:00:00.000Z",
        }],
      },
    }),
    /cannot contain capture outputs.*capture receipts.*Project Asset references/i,
  );
  assert.equal(writes, 0);
  assert.deepEqual(calls.map(({ command }) => command), [
    { action: "list_director_stages" },
  ]);
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

test("bounded Director mutations to one Stage are serialized and each reapplies to the latest revision", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let currentState: any = structuredClone(state);
  let revision = 1;
  let receipt = "director-host-receipt-1";
  const client: ProjectHostClient = {
    resolveContext: async ({ projectId, cwd } = {}) => ({
      projectId: projectId ?? "project-marker",
      source: projectId ? "explicit" : "marker",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request<T extends ProjectHostResponse>(request: ProjectHostRequest<T>) {
      calls.push(request);
      if (request.command.action === "list_director_stages") {
        return {
          projectId: request.projectId ?? "project-marker",
          value: {
            stages: [{
              ...stage,
              revisionId: `revision-${revision}`,
              state: structuredClone(currentState),
            }],
            versions: { "stage-1": receipt },
          } as unknown as T,
        };
      }
      assert.equal(request.command.action, "update_director_stage_state");
      const command = request.command as Extract<
        ProjectHostRequest["command"],
        { action: "update_director_stage_state" }
      >;
      if (command.ifMatch !== receipt) {
        return {
          projectId: request.projectId ?? "project-marker",
          value: {
            code: "STALE_READ",
            error: "Stale Director Stage apply rejected (STALE_READ).",
          } as unknown as T,
        };
      }
      currentState = structuredClone(command.state);
      revision += 1;
      receipt = `director-host-receipt-${revision}`;
      return {
        projectId: request.projectId ?? "project-marker",
        value: {
          stage: {
            ...stage,
            revisionId: `revision-${revision}`,
            state: structuredClone(currentState),
          },
          readToken: receipt,
        } as unknown as T,
      };
    },
  };
  const adapter = createDirectorAdapter({
    client,
    writeProjection: async () => undefined,
  });
  const objects = ["hero", "floor", "crate", "light"].map((id) => ({
    id,
    name: id,
    kind: "primitive",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    primitive: { shape: "box" },
  }));

  const results = await Promise.allSettled(objects.map((object) =>
    adapter.mutate("clash_director_object_add", {
      projectId: "project-1",
      stageId: "stage-1",
      object,
    })
  ));

  assert.deepEqual(results.map(({ status }) => status), [
    "fulfilled",
    "fulfilled",
    "fulfilled",
    "fulfilled",
  ]);
  assert.deepEqual(
    currentState.objects.map((object: { id: string }) => object.id),
    objects.map(({ id }) => id),
  );
  assert.deepEqual(calls.map(({ command }) => command.action), [
    "list_director_stages",
    "update_director_stage_state",
    "list_director_stages",
    "update_director_stage_state",
    "list_director_stages",
    "update_director_stage_state",
    "list_director_stages",
    "update_director_stage_state",
  ]);
});

test("bounded Director mutation preserves a real external STALE_READ without replay", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  let receipt = "director-host-receipt-1";
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => {
      if (request.command.action === "list_director_stages") {
        return {
          stages: [stage],
          versions: { "stage-1": receipt },
        };
      }
      assert.equal(request.command.action, "update_director_stage_state");
      const command = request.command as Extract<
        ProjectHostRequest["command"],
        { action: "update_director_stage_state" }
      >;
      return command.ifMatch === receipt
        ? { stage, readToken: receipt }
        : {
            code: "STALE_READ",
            error: "Stale Director Stage apply rejected (STALE_READ).",
          };
    }),
    writeProjection: async () => {
      receipt = "director-host-receipt-external";
    },
  });

  await assert.rejects(
    adapter.mutate("clash_director_object_add", {
      projectId: "project-1",
      stageId: "stage-1",
      object: {
        id: "hero",
        name: "Hero",
        kind: "primitive",
        visible: true,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        primitive: { shape: "box" },
      },
    }),
    /STALE_READ/,
  );
  assert.deepEqual(calls.map(({ command }) => command.action), [
    "list_director_stages",
    "update_director_stage_state",
  ]);
});

test("Director capture calls the typed host renderer command directly", async () => {
  const { createDirectorAdapter } = await import("./adapter.js");
  const calls: ProjectHostRequest[] = [];
  const writes: Array<{ path: string; content: string | Uint8Array }> = [];
  const adapter = createDirectorAdapter({
    client: hostClient(calls, (request) => request.command.action === "list_director_stages"
      ? { stages: [stage], versions: { "stage-1": "director-host-receipt" } }
      : {
          captured: true,
          stageId: "stage-1",
          sourceStageRevisionId: "revision-1",
          renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
          stateSha256: "state-hash",
          readToken: "capture-internal-receipt",
          version: "capture-internal-version",
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
    writeProjection: async (path, content) => { writes.push({ path, content }); },
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
  assert.doesNotMatch(
    JSON.stringify(result),
    /readToken|receipt.*capture-internal|capture-internal-version/i,
  );
  assert.ok(writes.some(({ path }) => path.endsWith("opening.png")));
  const captureReceipt = writes.find(({ path }) => path.endsWith("capture.json"));
  assert.ok(captureReceipt);
  assert.doesNotMatch(
    String(captureReceipt.content),
    /readToken|capture-internal-receipt|capture-internal-version/i,
  );
});
