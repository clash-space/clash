import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalApiApp } from "./app.js";

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
    const createdBody = await created.json() as {
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
      nodes: [expect.objectContaining({ id: createdBody.node_id, type: "text" })],
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
      listPluginCards: async () => [{
        pluginId: "test.canvas-actions",
        version: "1.2.0",
        schemaHash: `sha256:${"c".repeat(64)}`,
        runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs", args: [] },
        document: {
          apiVersion: "clash.card/v1",
          kind: "action-card",
          spec: {
            id: "test.caption-helper",
            name: "Caption Helper",
            outputType: "text",
            parameters: [],
            input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
            constraints: [],
            presentation: { type: "form" },
            functionExportId: "run-caption-helper",
          },
        },
      }],
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
