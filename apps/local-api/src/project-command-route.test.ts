import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProjectTimeline } from "@clash/shared-types";
import { createLocalApiApp } from "./app.js";
import type { LocalProjectAssetReplica } from "./local-project-assets.js";
import { LocalLoroRoomHub } from "./sync.js";

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

  it("materializes Asset binding authority before accepting a Timeline render", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
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
    await expect(requested.json()).resolves.toMatchObject({
      submitted: true,
      timelineId: "cut-1",
      renderNodeId: expect.any(String),
      target: { kind: "project-assets" },
    });
  });

  it("keeps an applied Timeline in the live Project replica across a Project Asset import", async () => {
    const projectId = "live-timeline-project";
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    await hub.room(projectId);
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: (id, read) => hub.inspectProject(id, read),
      mutate: (id, mutation) => hub.mutateProject(id, mutation),
    };
    const app = createLocalApiApp({
      dataDir,
      clashRoot: dataDir,
      userId: "trusted-local-user",
      projectAssetReplica,
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

      const liveTimeline = await hub.inspectProject(projectId, (doc) =>
        readProjectTimeline(doc, "cut-live"),
      );
      expect(liveTimeline?.state).toMatchObject({
        durationInFrames: 48,
        tracks: [
          {
            id: "titles",
            items: [expect.objectContaining({ id: "title-live" })],
          },
        ],
      });

      const requested = await command({
        action: "request_timeline_render",
        timelineId: "cut-live",
      });
      expect(requested.status).toBe(200);
      await expect(requested.json()).resolves.toMatchObject({
        submitted: true,
        timelineId: "cut-live",
        renderNodeId: expect.any(String),
      });
    } finally {
      await hub.close();
    }
  });

  it("wakes Project work after accepting a Timeline render request", async () => {
    const wokenProjects: string[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "trusted-local-user",
      processProjectWork: async (projectId) => {
        wokenProjects.push(projectId);
      },
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
      timelineId: "cut-to-render",
    });
    expect(wokenProjects).toEqual(["p1"]);
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
      body: JSON.stringify({
        action: "request_timeline_render",
        timelineId: "missing-cut",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      error: "Timeline missing-cut not found",
    });
    expect(wokenProjects).toEqual([]);
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
