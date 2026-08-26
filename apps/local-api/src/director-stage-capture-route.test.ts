import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Canvas,
  listActionAssetBindings,
  readOutputCommit,
  readProjectActionRun,
  readProjectAsset,
  type ExecutablePluginGeneratorRegistration,
} from "@clash/shared-types";
import type { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalApiApp } from "./app.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import type { LocalProjectAssetReplica } from "./local-project-assets.js";
import {
  createConfiguredLocalAcpAdapter,
  startLocalApiServer,
} from "./server.js";
import { LocalLoroRoomHub } from "./sync.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function directorGenerators(): Promise<ExecutablePluginGeneratorRegistration[]> {
  const document = JSON.parse(
    await readFile(
      join(process.cwd(), "../../plugins/director/generators/director-stage.json"),
      "utf8",
    ),
  ) as ExecutablePluginGeneratorRegistration["document"];
  return [{
    pluginId: "clash.director",
    version: "0.1.0",
    schemaHash: `sha256:${"0".repeat(64)}`,
    document,
  }];
}

function authorities(hub: LocalLoroRoomHub) {
  return {
    projectAssetReplica: {
      inspect: <T>(id: string, read: Parameters<LocalProjectAssetReplica["inspect"]>[1]) =>
        hub.inspectProject(id, read) as Promise<T>,
      mutate: (id: string, mutation: Parameters<LocalProjectAssetReplica["mutate"]>[1]) =>
        hub.mutateProject(id, mutation),
    } as LocalProjectAssetReplica,
    generatorProjectAuthority: {
      inspect: <T>(id: string, read: (doc: LoroDoc) => T | Promise<T>) =>
        hub.inspectProject(id, read),
      mutate: <T>(id: string, mutation: (doc: LoroDoc, checkpoint: () => Promise<void>) => T | Promise<T>) =>
        hub.mutateProjectWithCheckpoint(id, mutation),
    },
  };
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function productionHarness(options: { fail?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "clash-director-native-capture-"));
  directories.push(root);
  const dataDir = join(root, "local-api");
  const render = vi.fn(async (request: any) => {
    if (options.fail) throw new Error("renderer exploded");
    return {
      renderer: { id: "clash-director-viewport-webgl" as const, contractVersion: 1 as const },
      stateSha256: "a".repeat(64),
      frames: request.frames.map((frame: any) => ({
        ...frame,
        width: 1,
        height: 1,
        mimeType: "image/png" as const,
        dataBase64: PNG,
        sha256: "b".repeat(64),
      })),
    };
  });
  const server = await startLocalApiServer({
    dataDir,
    port: 0,
    remotePersistence: null,
    discovery: { enabled: false },
    localAcp: createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" }),
    directorStageRenderer: { render, dispose: async () => undefined },
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local-api did not bind");
  const projectId = `director-${Math.random().toString(16).slice(2)}`;
  const command = (body: unknown) => fetch(
    `http://127.0.0.1:${address.port}/api/v1/projects/${projectId}/host-command`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { dataDir, projectId, command, render, close };
}

async function createStage(command: (body: unknown) => Response | Promise<Response>, id = "stage-1") {
  const created = await command({ action: "create_director_stage", stageId: id, name: "Native Stage" });
  expect(created.status, await created.clone().text()).toBe(200);
  const listedResponse = await command({ action: "list_director_stages" });
  const listed = await listedResponse.json() as { stages: Array<{ id: string; revisionId: string }>; versions: Record<string, string> };
  return {
    readProof: listed.versions[id]!,
    revisionId: listed.stages.find((stage) => stage.id === id)!.revisionId,
    listed,
  };
}

async function capture(command: (body: unknown) => Response | Promise<Response>, revisionId: string, frames: unknown[]) {
  return command({
    action: "capture_director_stage",
    stageId: "stage-1",
    frames,
    longEdge: 1280,
    actorClientType: "agent",
    ifMatch: revisionId,
  });
}

async function waitForRuns(dataDir: string, projectId: string, ids: string[], status: "succeeded" | "failed") {
  const store = new FileReplicaStore(join(dataDir, "projects"));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const doc = await store.recover(projectId);
    const runs = ids.map((id) => readProjectActionRun(doc, id));
    if (runs.every((run) => run?.status === status)) return { doc, runs };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const doc = await store.recover(projectId);
  throw new Error(`runs did not become ${status}: ${JSON.stringify(ids.map((id) => readProjectActionRun(doc, id)))}`);
}

describe("Director Stage native capture migration", () => {
  it("creates and lists a native Stage without writing the retired directorStages map", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-director-native-stage-"));
    directories.push(dataDir);
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    try {
      const app = createLocalApiApp({
        dataDir,
        listPluginGenerators: directorGenerators,
        ...authorities(hub),
      });
      const command = (body: unknown) => app.request("/api/v1/projects/p1/host-command", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const { listed } = await createStage(command);
      expect(listed.stages).toEqual([expect.objectContaining({ id: "stage-1" })]);
      await expect(hub.inspectProject("p1", (doc) => doc.getMap("directorStages").get("stage-1"))).resolves.toBeUndefined();
    } finally {
      await hub.close();
    }
  });

  it("submits one revision-pinned ActionRun and processes it into a durable OutputCommit", async () => {
    const h = await productionHarness();
    try {
      const { readProof, revisionId } = await createStage(h.command);
      const response = await capture(h.command, readProof, [{ label: "hero", timeSeconds: 0, aspectRatio: "16:9" }]);
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json() as { submitted: boolean; sourceStageRevisionId: string; runs: Array<{ actionRunId: string }> };
      expect(body).toMatchObject({ submitted: true, sourceStageRevisionId: revisionId });
      const runId = body.runs[0]!.actionRunId;
      const { doc, runs } = await waitForRuns(h.dataDir, h.projectId, [runId], "succeeded");
      expect(runs[0]).toMatchObject({ actionRunId: runId, generatorRevision: { generatorId: "stage-1", generatorRevisionId: revisionId }, status: "succeeded" });
      const commit = readOutputCommit(doc, { actionRunId: runId, outputSlot: "frame" });
      expect(commit).toMatchObject({ actionRunId: runId, outputSlot: "frame", asset: { kind: "media", projectAssetId: expect.any(String) } });
      expect(readProjectAsset(doc, (commit!.asset as { projectAssetId: string }).projectAssetId)).toMatchObject({ lifecycle: { state: "active" } });
      expect(h.render).toHaveBeenCalledOnce();
      expect(new Canvas(doc, () => {}).readNode(runId)).toBeNull();
      expect(listActionAssetBindings(doc).filter((binding) => binding.owner.kind === "run" && binding.owner.actionRunId === runId)).toEqual([]);
    } finally { await h.close(); }
  });

  it("creates one run and OutputCommit per frame, pinned to the same Stage revision", async () => {
    const h = await productionHarness();
    try {
      const { readProof, revisionId } = await createStage(h.command);
      const response = await capture(h.command, readProof, [
        { label: "first", timeSeconds: 0, aspectRatio: "1:1" },
        { label: "second", timeSeconds: 1, aspectRatio: "9:16" },
      ]);
      const body = await response.json() as { runs: Array<{ actionRunId: string }> };
      expect(body.runs).toHaveLength(2);
      const ids = body.runs.map((run) => run.actionRunId);
      const { doc, runs } = await waitForRuns(h.dataDir, h.projectId, ids, "succeeded");
      expect(new Set(ids).size).toBe(2);
      expect(runs.map((run) => run!.generatorRevision.generatorRevisionId)).toEqual([revisionId, revisionId]);
      expect(ids.map((actionRunId) => readOutputCommit(doc, { actionRunId, outputSlot: "frame" }))).toEqual([
        expect.objectContaining({ actionRunId: ids[0] }),
        expect.objectContaining({ actionRunId: ids[1] }),
      ]);
      expect(h.render).toHaveBeenCalledTimes(2);
    } finally { await h.close(); }
  });

  it("rejects a stale Stage read proof before submitting work", async () => {
    const h = await productionHarness();
    try {
      const { readProof } = await createStage(h.command);
      const updated = await h.command({
        action: "update_director_stage_state",
        stageId: "stage-1",
        actorClientType: "agent",
        ifMatch: readProof,
        state: {
          schemaVersion: 1,
          scene: { backgroundColor: "#123456", grid: { visible: true, snap: false, size: 1 } },
          objects: [], cameras: [], shots: [],
        },
      });
      expect(updated.status, await updated.clone().text()).toBe(200);
      await expect(updated.clone().json()).resolves.toMatchObject({ stage: { revisionId: expect.any(String) } });
      const rejected = await capture(h.command, readProof, [{ label: "stale", timeSeconds: 0, aspectRatio: "1:1" }]);
      expect(rejected.status).toBe(200);
      const rejectedBody = await rejected.json();
      expect(rejectedBody).toMatchObject({ code: "STALE_READ" });
      expect(h.render).not.toHaveBeenCalled();
    } finally { await h.close(); }
  });

  it("records renderer/plugin failure as a failed native ActionRun", async () => {
    const h = await productionHarness({ fail: true });
    try {
      const { readProof } = await createStage(h.command);
      const response = await capture(h.command, readProof, [{ label: "broken", timeSeconds: 0, aspectRatio: "1:1" }]);
      const body = await response.json() as { runs: Array<{ actionRunId: string }> };
      const runId = body.runs[0]!.actionRunId;
      const { doc, runs } = await waitForRuns(h.dataDir, h.projectId, [runId], "failed");
      expect(runs[0]).toMatchObject({ actionRunId: runId, status: "failed" });
      expect(readOutputCommit(doc, { actionRunId: runId, outputSlot: "frame" })).toBeNull();
      expect(h.render).toHaveBeenCalledOnce();
    } finally { await h.close(); }
  });

  it("checkpoints native capture facts so a fresh replica recovery sees the run, commit, and Asset", async () => {
    const h = await productionHarness();
    try {
      const { readProof } = await createStage(h.command);
      const response = await capture(h.command, readProof, [{ label: "durable", timeSeconds: 0, aspectRatio: "4:3" }]);
      const body = await response.json() as { runs: Array<{ actionRunId: string }> };
      const runId = body.runs[0]!.actionRunId;
      await waitForRuns(h.dataDir, h.projectId, [runId], "succeeded");
      const recovered = await new FileReplicaStore(join(h.dataDir, "projects")).recover(h.projectId);
      const commit = readOutputCommit(recovered, { actionRunId: runId, outputSlot: "frame" });
      expect(readProjectActionRun(recovered, runId)?.status).toBe("succeeded");
      expect(commit).not.toBeNull();
      expect(readProjectAsset(recovered, (commit!.asset as { projectAssetId: string }).projectAssetId)).not.toBeNull();
      expect(recovered.getMap("directorStages").get("stage-1")).toBeUndefined();
    } finally { await h.close(); }
  });
});
