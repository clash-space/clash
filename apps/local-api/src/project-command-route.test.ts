import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Canvas,
  generatorDefinitionFromExecutablePluginRegistration,
  readProjectActionRun,
  readProjectGenerator,
  readProjectTimeline,
  type ExecutablePluginGeneratorRegistration,
} from "@clash/shared-types";
import { createLocalApiApp } from "./app.js";
import type { LocalProjectAssetReplica } from "./local-project-assets.js";
import { LocalLoroRoomHub } from "./sync.js";

async function timelineGeneratorRegistrations(): Promise<
  ExecutablePluginGeneratorRegistration[]
> {
  const document = JSON.parse(
    await readFile(
      join(process.cwd(), "../../plugins/remotion/generators/timeline.json"),
      "utf8",
    ),
  ) as ExecutablePluginGeneratorRegistration["document"];
  return [{
    pluginId: "clash.remotion",
    version: "1.0.0",
    schemaHash: `sha256:${"a".repeat(64)}`,
    document,
  }];
}

async function timelineGeneratorDefinition() {
  return generatorDefinitionFromExecutablePluginRegistration(
    (await timelineGeneratorRegistrations())[0]!,
  );
}

async function directorStageGeneratorRegistrations(): Promise<ExecutablePluginGeneratorRegistration[]> {
  const timeline = (await timelineGeneratorRegistrations())[0]!;
  return [{
    pluginId: "clash.director", version: "1.0.0", schemaHash: `sha256:${"d".repeat(64)}`,
    document: {
      apiVersion: "clash.generator/v1", kind: "generator",
      spec: {
        definitionId: "director-stage", stateSchema: { type: "object" }, editPolicy: "advance-head",
        persistentInputs: [{ slot: "stage:media", accepts: [{ kind: "media", mediaKind: "image" }], cardinality: { minItems: 0, maxItems: null } }],
        actions: [{ id: "capture-frame", executorExportId: "capture-frame", parametersSchema: { type: "object" }, invocationInputs: [], outputs: [{ slot: "capture:output", assetType: { kind: "media", mediaKind: "image" }, cardinality: { minItems: 1, maxItems: 1 } }] }],
        projectionSurface: { id: "clash.director-stage", stateKey: "stage", mediaInputSlot: "stage:media", primaryActionId: "capture-frame" },
      },
    } as typeof timeline.document,
  }];
}

function hubAuthorities(hub: LocalLoroRoomHub) {
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

describe("project host command route", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clash-project-host-route-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns structured validation errors", async () => {
    const response = await createLocalApiApp({ dataDir }).request(
      "/api/v1/projects/p1/host-command",
      { method: "POST", body: JSON.stringify({ action: "get" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid project host command",
      details: expect.arrayContaining([
        expect.objectContaining({ path: ["nodeId"] }),
      ]),
    });
  });

  it("serializes mutations into the local-api replica and serves later reads", async () => {
    const app = createLocalApiApp({ dataDir, userId: "trusted-local-user" });
    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      body: JSON.stringify({
        action: "add",
        canvasId: "main",
        type: "text",
        label: "Opening",
        content: "Hello",
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      node_id?: string;
      node?: { data?: Record<string, unknown> };
    };
    expect(createdBody.node_id).toBeTruthy();
    expect(createdBody.node?.data).toMatchObject({
      actorType: "user",
      actorUserId: "trusted-local-user",
    });

    const listed = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      body: JSON.stringify({ action: "list", canvasId: "main" }),
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      nodes: [
        expect.objectContaining({ id: createdBody.node_id, type: "text" }),
      ],
    });
  });

  it("submits a migrated Timeline as a pending native Generator ActionRun", async () => {
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    const definition = await timelineGeneratorDefinition();
    const wokenProjects: string[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
      listPluginGenerators: timelineGeneratorRegistrations,
      resolveGeneratorDefinition: async () => definition,
      ...hubAuthorities(hub),
      processProjectWork: async (projectId) => { wokenProjects.push(projectId); },
    });
    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create_timeline",
        timelineId: "cut-1",
        name: "Cut",
        state: {
          durationInFrames: 24,
          tracks: [
            {
              id: "titles",
              items: [
                {
                  id: "title-1",
                  type: "text",
                  from: 0,
                  durationInFrames: 24,
                },
              ],
            },
          ],
        },
      }),
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      timeline: { id: "cut-1" },
    });

    const requested = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request_timeline_render",
        timelineId: "cut-1",
      }),
    });

    expect(requested.status).toBe(200);
    const submission = await requested.json() as {
      submitted: boolean;
      actionRunId: string;
      renderNodeId: string;
      sourceTimelineRevisionId: string;
      run: { status: string };
    };
    expect(submission).toMatchObject({ submitted: true, run: { status: "running" } });
    expect(submission.renderNodeId).toBe(submission.actionRunId);
    const facts = await hub.inspectProject("p1", (doc) => ({
      run: readProjectActionRun(doc, submission.actionRunId),
      legacyTimeline: readProjectTimeline(doc, "cut-1"),
      renderNode: new Canvas(doc, () => {}).readNode(submission.actionRunId),
    }));
    expect(facts.run).toMatchObject({
      actionRunId: submission.actionRunId,
      actionId: definition.projectionSurface!.primaryActionId,
      generatorRevision: {
        generatorId: "cut-1",
        generatorRevisionId: submission.sourceTimelineRevisionId,
      },
      status: "running",
    });
    expect(facts.legacyTimeline).toBeNull();
    expect(facts.renderNode).toBeNull();
    expect(wokenProjects).toEqual(["p1"]);
    await hub.close();
  });

  it("keeps an applied Timeline in the live Project replica across a Project Asset import", async () => {
    const projectId = "live-timeline-project";
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    await hub.room(projectId);
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: (id, read) => hub.inspectProject(id, read),
      mutate: (id, mutation) => hub.mutateProject(id, mutation),
    };
    const definition = await timelineGeneratorDefinition();
    const app = createLocalApiApp({
      dataDir,
      clashRoot: dataDir,
      userId: "trusted-local-user",
      listPluginGenerators: timelineGeneratorRegistrations,
      resolveGeneratorDefinition: async () => definition,
      ...hubAuthorities(hub),
      inspectAssetResource: async ({ resource }) => ({
        width: 1,
        height: 1,
        rotationDegrees: 0,
        ...(resource.contentType ? { contentType: resource.contentType } : {}),
      }),
    });
    const command = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/host-command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      const created = await command({
        action: "create_timeline",
        timelineId: "cut-live",
        name: "Live cut",
        state: { durationInFrames: 24, tracks: [] },
      });
      expect(created.status).toBe(200);

      const applied = await command({
        action: "update_timeline_state",
        timelineId: "cut-live",
        state: {
          durationInFrames: 48,
          tracks: [
            {
              id: "titles",
              items: [
                {
                  id: "title-live",
                  type: "text",
                  from: 0,
                  durationInFrames: 48,
                  text: "Replica authority",
                },
              ],
            },
          ],
        },
      });
      expect(applied.status).toBe(200);

      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "shot.png", {
          type: "image/png",
        }),
      );
      form.set("kind", "image");
      form.set("projectAssetId", "director:shot-live");
      const imported = await app.request(
        `http://127.0.0.1/api/v1/projects/${projectId}/assets/import-file`,
        { method: "POST", body: form },
      );
      expect(imported.status, await imported.clone().text()).toBe(201);

      const liveGenerator = await hub.inspectProject(projectId, (doc) =>
        readProjectGenerator(doc, "cut-live"),
      );
      expect(liveGenerator).not.toBeNull();
      const legacyTimeline = await hub.inspectProject(projectId, (doc) =>
        readProjectTimeline(doc, "cut-live"),
      );
      expect(legacyTimeline).toBeNull();

      const listed = await command({ action: "list_timelines" });
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject({
        timelines: [expect.objectContaining({ id: "cut-live" })],
      });

      const requested = await command({
        action: "request_timeline_render",
        timelineId: "cut-live",
      });
      expect(requested.status).toBe(200);
      const requestedBody = await requested.json() as { submitted: boolean; actionRunId: string; run: { status: string } };
      expect(requestedBody).toMatchObject({ submitted: true, run: { status: "running" } });
      const run = await hub.inspectProject(projectId, (doc) =>
        readProjectActionRun(doc, requestedBody.actionRunId),
      );
      expect(run).toMatchObject({ status: "running" });
    } finally {
      await hub.close();
    }
  });

  it("wakes Project work once after a native Timeline render submission", async () => {
    const wokenProjects: string[] = [];
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    const definition = await timelineGeneratorDefinition();
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
      processProjectWork: async (projectId) => {
        wokenProjects.push(projectId);
      },
      listPluginGenerators: timelineGeneratorRegistrations,
      resolveGeneratorDefinition: async () => definition,
      ...hubAuthorities(hub),
    });
    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create_timeline",
        timelineId: "cut-to-render",
        name: "Cut to render",
        state: {
          durationInFrames: 24,
          tracks: [
            {
              id: "titles",
              items: [
                {
                  id: "title-1",
                  type: "text",
                  from: 0,
                  durationInFrames: 24,
                },
              ],
            },
          ],
        },
      }),
    });
    expect(created.status).toBe(200);
    expect(wokenProjects).toEqual([]);

    const requested = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request_timeline_render",
        timelineId: "cut-to-render",
      }),
    });

    expect(requested.status).toBe(200);
    await expect(requested.json()).resolves.toMatchObject({
      submitted: true,
      run: { status: "running" },
    });
    expect(wokenProjects).toEqual(["p1"]);
    await hub.close();
  });

  it("does not wake Project work for an invalid Timeline render request", async () => {
    const wokenProjects: string[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
      processProjectWork: async (projectId) => {
        wokenProjects.push(projectId);
      },
    });

    const response = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request_timeline_render" }),
    });

    expect(response.status).toBe(400);
    expect(wokenProjects).toEqual([]);
  });

  it("does not wake Project work when a Timeline render request is rejected", async () => {
    const wokenProjects: string[] = [];
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    const definition = await timelineGeneratorDefinition();
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
      processProjectWork: async (projectId) => {
        wokenProjects.push(projectId);
      },
      listPluginGenerators: timelineGeneratorRegistrations,
      resolveGeneratorDefinition: async () => definition,
      ...hubAuthorities(hub),
    });

    const response = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request_timeline_render",
        timelineId: "missing-cut",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: "PROJECT_GENERATOR_NOT_FOUND",
      error: "Project Generator missing-cut not found.",
    });
    expect(wokenProjects).toEqual([]);
    await hub.close();
  });

  it("returns structured errors for missing and ambiguous Timeline projection claimants", async () => {
    const request = (app: ReturnType<typeof createLocalApiApp>) =>
      app.request("/api/v1/projects/p1/host-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "list_timelines" }),
      });

    const missing = await request(
      createLocalApiApp({ dataDir, listPluginGenerators: async () => [] }),
    );
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({
      code: "GENERATOR_PROJECTION_SURFACE_NOT_INSTALLED",
    });

    const registration = (await timelineGeneratorRegistrations())[0]!;
    const ambiguous = await request(
      createLocalApiApp({
        dataDir,
        listPluginGenerators: async () => [
          registration,
          { ...registration, pluginId: "clash.other-remotion" },
        ],
      }),
    );
    expect(ambiguous.status).toBe(409);
    await expect(ambiguous.json()).resolves.toMatchObject({
      code: "GENERATOR_PROJECTION_SURFACE_AMBIGUOUS",
    });
  });

  it("resolves zero, ambiguous, and unique executable Director Stage claimants", async () => {
    const request = (app: ReturnType<typeof createLocalApiApp>, action = "list_director_stages") =>
      app.request("/api/v1/projects/p1/host-command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const missing = await request(createLocalApiApp({ dataDir, listPluginGenerators: async () => [] }));
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({ code: "GENERATOR_PROJECTION_SURFACE_NOT_INSTALLED" });
    const registration = (await directorStageGeneratorRegistrations())[0]!;
    const ambiguous = await request(createLocalApiApp({ dataDir, listPluginGenerators: async () => [registration, { ...registration, pluginId: "clash.other-director" }] }));
    expect(ambiguous.status).toBe(409);
    await expect(ambiguous.json()).resolves.toMatchObject({ code: "GENERATOR_PROJECTION_SURFACE_AMBIGUOUS" });
    const successful = await request(createLocalApiApp({ dataDir, listPluginGenerators: directorStageGeneratorRegistrations }));
    expect(successful.status).toBe(200);
    await expect(successful.json()).resolves.toEqual({ stages: [], versions: {} });
  });

  it("rejects raw data and client-supplied user identity at the route schema", async () => {
    const response = await createLocalApiApp({ dataDir }).request(
      "/api/v1/projects/p1/host-command",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          type: "text",
          label: "Spoofed",
          data: { actorUserId: "other-user" },
          actorUserId: "other-user",
        }),
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid project host command",
      details: expect.arrayContaining([
        expect.objectContaining({ code: "unrecognized_keys" }),
      ]),
    });
  });

  it("accepts a model_gen add command and reaches the host handler like sibling *_gen types", async () => {
    const app = createLocalApiApp({ dataDir, userId: "trusted-local-user" });
    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        canvasId: "main",
        type: "model_gen",
        label: "Statue",
        prompt: "Create a 3D statue",
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      node_id?: string;
      node?: { type?: string; data?: Record<string, unknown> };
    };
    expect(createdBody.node_id).toBeTruthy();
    expect(createdBody.node?.data).toMatchObject({
      actionType: "model-gen",
      modelId: expect.any(String),
    });
  });

  it("executes a model_gen action node through the real host-command route instead of rejecting it as 'not a generation node'", async () => {
    // Regression test for `Canvas.executeGeneration`'s built-in-actionType
    // gate: it used to enumerate only image/video/audio/text-gen, so any
    // model_gen action-badge (Tripo, Meshy, ...) failed execution before
    // ever reaching the provider with "Node ... is not a generation node".
    // Exercises the real `/host-command` HTTP route (add then execute) —
    // Canvas.execute is not mocked.
    const app = createLocalApiApp({ dataDir, userId: "trusted-local-user" });
    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        canvasId: "main",
        type: "model_gen",
        label: "Statue",
        prompt: "Create a 3D statue",
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      node_id?: string;
    };
    const nodeId = createdBody.node_id;
    expect(nodeId).toBeTruthy();

    const executed = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        canvasId: "main",
        nodeId,
      }),
    });

    expect(executed.status).toBe(200);
    const executedBody = (await executed.json()) as {
      error?: string;
      executed?: boolean;
      kind?: string;
      childNodeId?: string;
      childNodeType?: string;
    };
    expect(executedBody.error).toBeUndefined();
    expect(executedBody.error).not.toBe(`Node ${nodeId} is not a generation node`);
    expect(executedBody.executed).toBe(true);
    expect(executedBody.kind).toBe("generation");
    expect(executedBody.childNodeType).toBe("model");
    expect(executedBody.childNodeId).toBeTruthy();

    const listed = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list", canvasId: "main" }),
    });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    };
    const child = listedBody.nodes?.find(
      (n) => n.id === executedBody.childNodeId,
    );
    expect(child?.type).toBe("model");
    expect(child?.data).toMatchObject({ status: "pending" });
  });

  it("resolves active plugin actions inside local-api before creating the node", async () => {
    const app = createLocalApiApp({
      dataDir,
      listPluginCards: async () => [
        {
          pluginId: "test.canvas-actions",
          version: "1.2.0",
          schemaHash: `sha256:${"c".repeat(64)}`,
          runtime: {
            kind: "local",
            transport: "stdio",
            entrypoint: "handler.mjs",
            args: [],
          },
          document: {
            apiVersion: "clash.card/v1",
            kind: "action-card",
            spec: {
              id: "test.caption-helper",
              name: "Caption Helper",
              outputType: "text",
              parameters: [],
              input: {
                requiresPrompt: true,
                inputMode: {},
                promptModalities: ["text"],
              },
              constraints: [],
              presentation: { type: "form" },
              functionExportId: "run-caption-helper",
            },
          },
        },
      ],
    });

    const created = await app.request("/api/v1/projects/p1/host-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        type: "text_gen",
        label: "Caption",
        prompt: "Write a caption",
        actionId: "test.caption-helper",
      }),
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      node: {
        data: {
          customActionId: "test.caption-helper",
          outputType: "text",
          pluginBinding: {
            pluginId: "test.canvas-actions",
            version: "1.2.0",
            exportId: "run-caption-helper",
          },
        },
      },
    });
  });
});
