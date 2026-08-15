import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listActionAssetBindings,
  readProjectAsset,
  readProjectDirectorStage,
  updateProjectDirectorStageState,
} from "@clash/shared-types";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiApp } from "./app";
import type { LocalProjectAssetReplica } from "./local-project-assets";
import { FileReplicaStore } from "./loro/file-replica-store";
import {
  createConfiguredLocalAcpAdapter,
  createLocalPluginBrokerServices,
  startLocalApiServer,
} from "./server";
import { LocalLoroRoomHub } from "./sync";

const CAPTURE_DATA_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CAPTURE_SHA256 = createHash("sha256")
  .update(Buffer.from(CAPTURE_DATA_BASE64, "base64"))
  .digest("hex");

describe("Director Stage capture host route", () => {
  it("publishes a browser-rendered output as a revision-pinned run reference without advancing the Stage", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-output-reference-"),
    );
    const projectId = "project-director-output-reference";
    const doc = new LoroDoc();
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: async (_projectId, read) => read(doc),
      mutate: async (_projectId, mutation) => (await mutation(doc)).value,
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      projectAssetReplica,
      inspectAssetResource: async ({ resource }) => ({
        width: 1280,
        height: 720,
        durationMs: 1_000,
        rotationDegrees: 0,
        frameRate: 30,
        videoCodec: "vp8",
        hasAudio: false,
        ...(resource.contentType ? { contentType: resource.contentType } : {}),
      }),
    });
    const command = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/host-command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect(
      (
        await command({
          action: "create_director_stage",
          stageId: "stage-output",
          name: "Output Stage",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await command({
          action: "attach_director_stage",
          stageId: "stage-output",
          canvasId: "main",
          actionNodeId: "director-node",
        })
      ).status,
    ).toBe(200);
    const before = (await (
      await command({ action: "list_director_stages" })
    ).json()) as {
      stages: Array<{ id: string; revisionId: string }>;
    };
    const sourceStageRevisionId = before.stages.find(
      (stage) => stage.id === "stage-output",
    )?.revisionId;
    expect(sourceStageRevisionId).toBeTruthy();

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "preview.webm", {
        type: "video/webm",
      }),
    );
    form.set("kind", "video");
    form.set("sourceStageRevisionId", sourceStageRevisionId!);
    form.set("artifactId", "preview-1");
    const publishedResponse = await app.request(
      `/api/v1/projects/${projectId}/director-stages/stage-output/outputs`,
      { method: "POST", body: form },
    );

    expect(
      publishedResponse.status,
      await publishedResponse.clone().text(),
    ).toBe(201);
    const published = (await publishedResponse.json()) as {
      asset: { id: string };
      binding: {
        owner: {
          kind: string;
          actionId: string;
          actionRevisionId: string;
          actionRunId: string;
        };
        direction: string;
        projectAssetId: string;
      };
    };
    expect(published.binding).toMatchObject({
      owner: {
        kind: "run",
        actionId: "node:director-node",
        actionRevisionId: sourceStageRevisionId,
        actionRunId: expect.any(String),
      },
      direction: "output",
      projectAssetId: published.asset.id,
    });
    expect(
      listActionAssetBindings(doc).filter(
        (binding) => binding.projectAssetId === published.asset.id,
      ),
    ).toEqual([published.binding]);
    expect(readProjectAsset(doc, published.asset.id)).toMatchObject({
      id: published.asset.id,
      lifecycle: { state: "active" },
      provenance: {
        kind: "render",
        actionRunId: published.binding.owner.actionRunId,
      },
    });

    const after = (await (
      await command({ action: "list_director_stages" })
    ).json()) as {
      stages: Array<{ id: string; revisionId: string }>;
    };
    expect(
      after.stages.find((stage) => stage.id === "stage-output")?.revisionId,
    ).toBe(sourceStageRevisionId);
  });

  it("rejects capture publication when the Stage changes after render readback", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-publication-race-"),
    );
    const projectId = "project-director-capture-publication-race";
    const stageId = "stage-publication-race";
    const doc = new LoroDoc();
    let raceArmed = false;
    let raceInjected = false;
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: async (_projectId, read) => read(doc),
      mutate: async (_projectId, mutation) => {
        if (raceArmed && !raceInjected) {
          raceInjected = true;
          const stage = readProjectDirectorStage(doc, stageId);
          expect(stage).not.toBeNull();
          const changed = updateProjectDirectorStageState(doc, stageId, {
            ...stage!.state,
            scene: {
              ...stage!.state.scene,
              backgroundColor: "#123456",
            },
          });
          expect(changed.ok).toBe(true);
        }
        return (await mutation(doc)).value;
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      projectAssetReplica,
      directorStageRenderer: {
        async render(request) {
          raceArmed = true;
          return {
            renderer: {
              id: "clash-director-viewport-webgl" as const,
              contractVersion: 1 as const,
            },
            stateSha256: "a".repeat(64),
            frames: request.frames.map((frame) => ({
              ...frame,
              width: 1,
              height: 1,
              mimeType: "image/png" as const,
              dataBase64: CAPTURE_DATA_BASE64,
              sha256: CAPTURE_SHA256,
            })),
          };
        },
        dispose: async () => undefined,
      },
    });
    const command = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/host-command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await command({
          action: "create_director_stage",
          stageId,
          name: "Publication race",
        })
      ).status,
    ).toBe(200);
    const listed = (await (
      await command({ action: "list_director_stages" })
    ).json()) as { versions: Record<string, string> };

    const response = await command({
      action: "capture_director_stage",
      stageId,
      frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "1:1" }],
      longEdge: 1280,
      actorClientType: "agent",
      ifMatch: listed.versions[stageId],
    });

    expect(raceInjected).toBe(true);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STALE_READ",
    });
    expect(listActionAssetBindings(doc)).toEqual([]);
  });

  it("durably publishes captured Assets before the production Host responds", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "clash-director-capture-host-checkpoint-"),
    );
    const dataDir = join(root, "local-api");
    const projectId = "project-capture-host-checkpoint";
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;

    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        discovery: { enabled: false },
        localAcp: createConfiguredLocalAcpAdapter({
          CLASH_E2E_STUB_ACP: "1",
        }),
        directorStageRenderer: {
          async render(request) {
            return {
              renderer: {
                id: "clash-director-viewport-webgl" as const,
                contractVersion: 1 as const,
              },
              stateSha256: "a".repeat(64),
              frames: request.frames.map((frame) => ({
                ...frame,
                width: 1,
                height: 1,
                mimeType: "image/png" as const,
                dataBase64: CAPTURE_DATA_BASE64,
                sha256: CAPTURE_SHA256,
              })),
            };
          },
          dispose: async () => undefined,
        },
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("local-api did not bind a TCP port");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const command = async (body: unknown) =>
        fetch(`${origin}/api/v1/projects/${projectId}/host-command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      // The benchmark readiness gate is the first Project read. A read must not create an
      // uncheckpointed Canvas prefix that makes every later capture update undecodable.
      const ready = await command({ action: "ping" });
      expect(ready.status, await ready.clone().text()).toBe(200);
      const created = await command({
        action: "create_director_stage",
        stageId: "stage-checkpoint",
        name: "Checkpoint Stage",
      });
      expect(created.status, await created.clone().text()).toBe(200);
      const listed = (await (
        await command({ action: "list_director_stages" })
      ).json()) as { versions: Record<string, string> };
      const capture = await command({
        action: "capture_director_stage",
        stageId: "stage-checkpoint",
        frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "1:1" }],
        longEdge: 1280,
        actorClientType: "agent",
        ifMatch: listed.versions["stage-checkpoint"],
      });
      expect(capture.status, await capture.clone().text()).toBe(200);
      const captured = (await capture.json()) as {
        sourceStageRevisionId: string;
        frames: Array<{ projectAssetId: string }>;
      };
      const projectAssetId = captured.frames[0]?.projectAssetId;
      expect(projectAssetId).toMatch(/^director-capture:/u);

      const recovered = await new FileReplicaStore(
        join(dataDir, "projects"),
      ).recover(projectId);
      expect(readProjectAsset(recovered, projectAssetId!)).toMatchObject({
        id: projectAssetId,
        lifecycle: { state: "active" },
        provenance: {
          kind: "render",
          actionRunId: expect.stringMatching(/^director-capture:/u),
        },
      });
      expect(
        listActionAssetBindings(recovered).filter(
          (binding) => binding.projectAssetId === projectAssetId,
        ),
      ).toEqual([
        expect.objectContaining({
          owner: expect.objectContaining({
            kind: "run",
            actionRevisionId: captured.sourceStageRevisionId,
          }),
          direction: "output",
          projectAssetId,
        }),
      ]);
    } finally {
      if (server) {
        await new Promise<void>((resolveClose) =>
          server!.close(() => resolveClose()),
        );
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates a distinct Project Asset when a new Stage revision renders identical Resource bytes", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-revision-identity-"),
    );
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorStageRenderer: {
        async render(request) {
          return {
            renderer: {
              id: "clash-director-viewport-webgl" as const,
              contractVersion: 1 as const,
            },
            stateSha256: "a".repeat(64),
            frames: request.frames.map((frame) => ({
              ...frame,
              width: 1280,
              height: 720,
              mimeType: "image/png" as const,
              dataBase64: CAPTURE_DATA_BASE64,
              sha256: CAPTURE_SHA256,
            })),
          };
        },
        dispose: async () => undefined,
      },
    });
    const command = (body: unknown) =>
      app.request("/api/v1/projects/project-revision/host-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const createResponse = await command({
      action: "create_director_stage",
      stageId: "stage-revision",
      name: "Revision identity",
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      stage: {
        revisionId: string;
        state: Record<string, unknown> & {
          scene: Record<string, unknown>;
        };
      };
    };

    const capture = async () => {
      const listed = (await (
        await command({ action: "list_director_stages" })
      ).json()) as { versions: Record<string, string> };
      const response = await command({
        action: "capture_director_stage",
        stageId: "stage-revision",
        frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "16:9" }],
        longEdge: 1280,
        actorClientType: "mcp",
        ifMatch: listed.versions["stage-revision"],
      });
      const payload = (await response.json()) as {
        frames?: Array<{ projectAssetId?: string }>;
        error?: string;
      };
      expect(response.status, payload.error).toBe(200);
      return payload.frames?.[0]?.projectAssetId;
    };

    const firstAssetId = await capture();
    const listed = (await (
      await command({ action: "list_director_stages" })
    ).json()) as { versions: Record<string, string> };
    const updateResponse = await command({
      action: "update_director_stage_state",
      stageId: "stage-revision",
      state: {
        ...created.stage.state,
        scene: {
          ...created.stage.state.scene,
          backgroundColor: "#123456",
        },
      },
      actorClientType: "mcp",
      ifMatch: listed.versions["stage-revision"],
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as {
      stage: { revisionId: string };
      error?: string;
    };
    expect(updated.error).toBeUndefined();
    expect(updated.stage.revisionId).not.toBe(created.stage.revisionId);

    const secondAssetId = await capture();
    const replayedSecondAssetId = await capture();

    expect(firstAssetId).toMatch(/^director-capture:[a-f0-9]{32}$/u);
    expect(secondAssetId).toMatch(/^director-capture:[a-f0-9]{32}$/u);
    expect(secondAssetId).not.toBe(firstAssetId);
    expect(replayedSecondAssetId).toBe(secondAssetId);
  });

  it("publishes changed capture output under one Stage revision without rebinding the previous output", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-run-identity-"),
    );
    const projectId = "project-capture-run-identity";
    const changedBytes = Buffer.concat([
      Buffer.from(CAPTURE_DATA_BASE64, "base64"),
      Buffer.from([0]),
    ]);
    const changedDataBase64 = changedBytes.toString("base64");
    const changedSha256 = createHash("sha256")
      .update(changedBytes)
      .digest("hex");
    let renderCount = 0;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorStageRenderer: {
        async render(request) {
          const changed = renderCount++ > 0;
          return {
            renderer: {
              id: "clash-director-viewport-webgl" as const,
              contractVersion: 1 as const,
            },
            stateSha256: "a".repeat(64),
            frames: request.frames.map((frame) => ({
              ...frame,
              width: 1,
              height: 1,
              mimeType: "image/png" as const,
              dataBase64: changed ? changedDataBase64 : CAPTURE_DATA_BASE64,
              sha256: changed ? changedSha256 : CAPTURE_SHA256,
            })),
          };
        },
        dispose: async () => undefined,
      },
    });
    const command = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/host-command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      expect(
        (
          await command({
            action: "create_director_stage",
            stageId: "stage-run-identity",
            name: "Capture run identity",
          })
        ).status,
      ).toBe(200);
      const listed = (await (
        await command({ action: "list_director_stages" })
      ).json()) as { versions: Record<string, string> };
      const capture = async () => {
        const response = await command({
          action: "capture_director_stage",
          stageId: "stage-run-identity",
          frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "1:1" }],
          longEdge: 1280,
          actorClientType: "agent",
          ifMatch: listed.versions["stage-run-identity"],
        });
        const payload = (await response.json()) as {
          sourceStageRevisionId?: string;
          frames?: Array<{ projectAssetId?: string }>;
          error?: string;
        };
        expect(response.status, payload.error).toBe(200);
        return {
          revisionId: payload.sourceStageRevisionId,
          assetId: payload.frames?.[0]?.projectAssetId,
        };
      };

      const first = await capture();
      const second = await capture();
      expect(second.revisionId).toBe(first.revisionId);
      expect(second.assetId).not.toBe(first.assetId);

      const recovered = await new FileReplicaStore(
        join(dataDir, "projects"),
      ).recover(projectId);
      for (const assetId of [first.assetId, second.assetId]) {
        expect(
          listActionAssetBindings(recovered).filter(
            (binding) =>
              binding.direction === "output" &&
              binding.projectAssetId === assetId,
          ),
        ).toEqual([
          expect.objectContaining({
            owner: expect.objectContaining({
              kind: "run",
              actionRevisionId: first.revisionId,
            }),
            direction: "output",
            projectAssetId: assetId,
          }),
        ]);
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("captures a persisted Stage through the typed project host command", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-command-"),
    );
    const render = vi.fn(async (request: any) => ({
      renderer: {
        id: "clash-director-viewport-webgl" as const,
        contractVersion: 1 as const,
      },
      stateSha256: "a".repeat(64),
      frames: request.frames.map((frame: any) => ({
        ...frame,
        width: 1280,
        height: 720,
        mimeType: "image/png" as const,
        dataBase64: CAPTURE_DATA_BASE64,
        sha256: CAPTURE_SHA256,
      })),
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorStageRenderer: { render, dispose: async () => undefined },
    });
    const command = (body: unknown) =>
      app.request("/api/v1/projects/project-1/host-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await command({
          action: "create_director_stage",
          stageId: "stage-1",
          name: "Blocking",
        })
      ).status,
    ).toBe(200);
    const listed = (await (
      await command({ action: "list_director_stages" })
    ).json()) as {
      versions: Record<string, string>;
    };

    const response = await command({
      action: "capture_director_stage",
      stageId: "stage-1",
      frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "16:9" }],
      longEdge: 1280,
      actorClientType: "mcp",
      ifMatch: listed.versions["stage-1"],
    });

    expect(response.status).toBe(200);
    const captured = (await response.json()) as {
      frames: Array<{ projectAssetId?: string }>;
    };
    expect(captured).toMatchObject({
      captured: true,
      stageId: "stage-1",
      sourceStageRevisionId: expect.any(String),
      renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
      frames: [
        {
          label: "opening",
          dataBase64: CAPTURE_DATA_BASE64,
          projectAssetId: expect.stringMatching(/^director-capture:/u),
        },
      ],
    });
    const projectAssetId = captured.frames[0]?.projectAssetId;
    expect(projectAssetId).toBeDefined();
    const asset = await app.request(
      `/api/v1/projects/project-1/assets/${encodeURIComponent(projectAssetId!)}`,
    );
    expect(asset.status).toBe(200);
    await expect(asset.json()).resolves.toMatchObject({
      id: projectAssetId,
      kind: "image",
      lifecycle: { state: "active" },
      status: "ready",
    });
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({ schemaVersion: 1 }),
        longEdge: 1280,
        frames: [{ label: "opening", timeSeconds: 0, aspectRatio: "16:9" }],
      }),
    );
  });

  it("reads a Stage capture before and after render from the injected live Project replica", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-live-replica-"),
    );
    const doc = new LoroDoc();
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: async (_projectId, read) => read(doc),
      mutate: async (_projectId, mutation) => (await mutation(doc)).value,
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      projectAssetReplica,
      directorStageRenderer: {
        async render(request) {
          return {
            renderer: {
              id: "clash-director-viewport-webgl",
              contractVersion: 1,
            },
            stateSha256: "a".repeat(64),
            frames: request.frames.map((frame) => ({
              ...frame,
              width: 1280,
              height: 720,
              mimeType: "image/png" as const,
              dataBase64: CAPTURE_DATA_BASE64,
              sha256: CAPTURE_SHA256,
            })),
          };
        },
        dispose: async () => undefined,
      },
    });
    const command = (body: unknown) =>
      app.request("/api/v1/projects/project-live/host-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect(
      (
        await command({
          action: "create_director_stage",
          stageId: "stage-live",
          name: "Live Stage",
        })
      ).status,
    ).toBe(200);
    const listed = (await (
      await command({ action: "list_director_stages" })
    ).json()) as { versions: Record<string, string> };

    const captured = await command({
      action: "capture_director_stage",
      stageId: "stage-live",
      frames: [{ label: "hero", timeSeconds: 0, aspectRatio: "16:9" }],
      longEdge: 1280,
      actorClientType: "agent",
      ifMatch: listed.versions["stage-live"],
    });

    expect(captured.status).toBe(200);
    await expect(captured.json()).resolves.toMatchObject({
      captured: true,
      stageId: "stage-live",
      sourceStageRevisionId: expect.any(String),
      frames: [{ label: "hero", dataBase64: CAPTURE_DATA_BASE64 }],
    });
  });

  it("publishes every captured frame to plugin Asset reads before returning", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-plugin-publication-"),
    );
    const projectId = "project-capture-plugin-publication";
    const hub = new LocalLoroRoomHub(dataDir);
    let mutationInFlight = false;
    const projectAssetReplica: LocalProjectAssetReplica = {
      inspect: (id, read) => hub.inspectProject(id, read),
      async mutate(id, mutation) {
        if (mutationInFlight) {
          throw new Error(
            "A capture cannot issue overlapping writes to one Project replica.",
          );
        }
        mutationInFlight = true;
        try {
          return await hub.mutateProject(id, mutation);
        } finally {
          mutationInFlight = false;
        }
      },
    };
    try {
      const app = createLocalApiApp({
        dataDir,
        userId: "local-user",
        projectAssetReplica,
        inspectAssetResource: async ({ resource }) => ({
          width: 1,
          height: 1,
          rotationDegrees: 0,
          ...(resource.contentType
            ? { contentType: resource.contentType }
            : {}),
        }),
        directorStageRenderer: {
          async render(request) {
            return {
              renderer: {
                id: "clash-director-viewport-webgl",
                contractVersion: 1,
              },
              stateSha256: "a".repeat(64),
              frames: request.frames.map((frame) => ({
                ...frame,
                width: 1,
                height: 1,
                mimeType: "image/png" as const,
                dataBase64: CAPTURE_DATA_BASE64,
                sha256: CAPTURE_SHA256,
              })),
            };
          },
          dispose: async () => undefined,
        },
      });
      const command = (body: unknown) =>
        app.request(`/api/v1/projects/${projectId}/host-command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect(
        (
          await command({
            action: "create_director_stage",
            stageId: "stage-publication",
            name: "Publication Stage",
          })
        ).status,
      ).toBe(200);
      for (const index of [0, 1]) {
        await hub.mutateProject(projectId, (doc) => {
          doc.getMap("capture-publication-prelude").set(String(index), true);
          return { value: undefined };
        });
      }
      const listed = (await (
        await command({ action: "list_director_stages" })
      ).json()) as { versions: Record<string, string> };
      const captureResponse = await command({
        action: "capture_director_stage",
        stageId: "stage-publication",
        frames: Array.from({ length: 12 }, (_, index) => ({
          label: `frame-${index}`,
          timeSeconds: index,
          aspectRatio: "1:1",
        })),
        longEdge: 1280,
        actorClientType: "agent",
        ifMatch: listed.versions["stage-publication"],
      });
      expect(captureResponse.status).toBe(200);
      const captured = (await captureResponse.json()) as {
        frames: Array<{ projectAssetId: string }>;
      };
      expect(captured.frames).toHaveLength(12);

      // Production plugin execution reads the durable Project replica because it can run while
      // the live room owns its mutation queue. The capture response is therefore the publication
      // barrier: no Asset get/list warm-up or retry may be needed before this broker read.
      const broker = createLocalPluginBrokerServices({ dataDir });
      await hub.mutateProject(projectId, async (doc) => {
        doc.getMap("capture-publication-consumer").set("started", true);
        for (const [index, frame] of captured.frames.entries()) {
          const reference = {
            slot: `frame-${index}`,
            index: 0,
            asset: {
              assetId: frame.projectAssetId,
              uri: `clash-asset://${frame.projectAssetId}`,
              kind: "image" as const,
            },
          };
          await expect(
            broker(
              {
                protocol: "clash.plugin.broker-request/v1",
                requestId: `resolve-frame-${index}`,
                invocationId: "capture-publication-invocation",
                operation: { kind: "asset.resolve", reference },
              },
              {
                manifest: {
                  apiVersion: "clash.plugin/v1",
                  id: "test.capture-reader",
                  version: "1.0.0",
                  name: "Capture reader",
                  runtime: {
                    kind: "local",
                    transport: "stdio",
                    entrypoint: "handler.mjs",
                    args: [],
                  },
                  contractTests: [],
                  contributes: {
                    cards: [],
                    providers: [],
                    modelBindings: [],
                    generators: [],
                    functions: [
                      {
                        id: "run",
                        kind: "action",
                        operations: ["submit"],
                      },
                    ],
                    hostTools: [],
                  },
                },
                invocation: {
                  protocol: "clash.plugin.invoke/v1",
                  invocationId: "capture-publication-invocation",
                  taskId: "capture-publication-task",
                  projectId,
                  target: {
                    pluginId: "test.capture-reader",
                    version: "1.0.0",
                    exportId: "run",
                    schemaHash: `sha256:${"e".repeat(64)}`,
                    kind: "action",
                  },
                  input: { values: {}, references: [reference] },
                  assetInputs: [
                    {
                      match: { kinds: ["image"], slots: [reference.slot] },
                      representations: ["bytes"],
                    },
                  ],
                  actor: { kind: "agent", id: "capture-reader" },
                  operation: "submit",
                },
              },
            ),
          ).resolves.toMatchObject({
            form: "bytes",
            kind: "image",
            bytesBase64: CAPTURE_DATA_BASE64,
          });
        }
        return { value: undefined };
      });
    } finally {
      await hub.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("exposes the injected product renderer without fabricating a fallback", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-route-"),
    );
    const render = vi.fn(async () => ({
      renderer: {
        id: "clash-director-viewport-webgl" as const,
        contractVersion: 1 as const,
      },
      stateSha256: "a".repeat(64),
      frames: [
        {
          label: "frame-opening",
          timeSeconds: 0,
          aspectRatio: "16:9" as const,
          activeCameraId: "camera-a",
          width: 1280,
          height: 720,
          mimeType: "image/png" as const,
          dataBase64: "AQID",
          sha256: "b".repeat(64),
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorStageRenderer: { render, dispose: async () => undefined },
    });
    const request = {
      state: {
        schemaVersion: 1,
        scene: {
          backgroundColor: "#171816",
          grid: { visible: true, snap: false, size: 1 },
        },
        objects: [],
        cameras: [],
        shots: [],
      },
      longEdge: 1280,
      frames: [{ label: "frame-opening", timeSeconds: 0, aspectRatio: "16:9" }],
    };

    const response = await app.request("/api/v1/local/director-stage/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      renderer: { id: "clash-director-viewport-webgl", contractVersion: 1 },
      frames: [{ label: "frame-opening", dataBase64: "AQID" }],
    });
    expect(render).toHaveBeenCalledWith(request);
  });

  it("fails closed when the daemon has no Director product renderer", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-director-capture-missing-"),
    );
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const response = await app.request("/api/v1/local/director-stage/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: {}, longEdge: 1280, frames: [] }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Director Stage product renderer is unavailable",
    });
  });
});
