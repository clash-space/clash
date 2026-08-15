import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { createWorkspaceBundleManifest } from "@clash/shared-runtime";
import { WorkspaceExportPlanSchema } from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalApiApp } from "./app.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "clash-workspace-routes-"));
  roots.push(dataDir);
  await createLocalMetadataStore(dataDir).save({
    projects: [
      {
        id: "project-route",
        ownerId: "local-user",
        name: "Route Project",
        description: null,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        deletedAt: null,
        assets: [],
      },
    ],
    assets: [],
    assetRefs: [],
    assetNodeRefs: [],
    sessions: [],
    agentMembers: [],
    sessionMessages: [],
  });
  const doc = new LoroDoc();
  const app = createLocalApiApp({
    dataDir,
    userId: "local-user",
    workspaceProjectAuthority: {
      inspect: async <T>(
        projectId: string,
        read: (candidate: LoroDoc) => T | Promise<T>,
      ) => {
        expect(projectId).toBe("project-route");
        return read(doc);
      },
    },
  } as Parameters<typeof createLocalApiApp>[0]);
  return { app };
}

describe("Workspace transfer Host routes", () => {
  it("creates a strict export plan and serves only opaque file capabilities", async () => {
    const { app } = await fixture();
    const created = await app.request(
      "/api/v1/projects/project-route/workspace-exports",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: "external:project-route:source-path",
        }),
      },
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const plan = (await created.json()) as {
      exportId: string;
      expiresAt: string;
      files: Array<{
        fileId: string;
        path: string;
        bytes: number;
        sha256: string;
      }>;
    };
    expect(plan.expiresAt).toMatch(/Z$/u);
    expect(plan.files).toEqual([
      expect.objectContaining({
        fileId: expect.not.stringContaining("snapshot"),
        path: "project.bin",
        role: "project",
      }),
    ]);

    const file = plan.files[0]!;
    const downloaded = await app.request(
      `/api/v1/workspace-exports/${encodeURIComponent(plan.exportId)}/files/${encodeURIComponent(file.fileId)}`,
    );
    expect(downloaded.status).toBe(200);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(bytes.byteLength).toBe(file.bytes);
    expect(downloaded.headers.get("etag")).toBe(`"sha256:${file.sha256}"`);
    expect(downloaded.headers.get("content-digest")).toBe(
      `sha-256=:${Buffer.from(file.sha256, "hex").toString("base64")}:`,
    );

    const guessedPath = await app.request(
      `/api/v1/workspace-exports/${encodeURIComponent(plan.exportId)}/files/project.bin`,
    );
    expect(guessedPath.status).toBe(404);
  });

  it("rejects extra request fields instead of accepting transport ambiguity", async () => {
    const { app } = await fixture();
    const response = await app.request(
      "/api/v1/projects/project-route/workspace-exports",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: "external:project-route:source-path",
          includeCredentials: true,
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("stages and commits a strict import over opaque Host file slots", async () => {
    const { app: sourceApp } = await fixture();
    const exported = await sourceApp.request(
      "/api/v1/projects/project-route/workspace-exports",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceWorkspaceId: "external:project-route:source-path",
        }),
      },
    );
    expect(exported.status, await exported.clone().text()).toBe(201);
    const plan = WorkspaceExportPlanSchema.parse(await exported.json());
    const payloads = new Map<string, Uint8Array>();
    for (const file of plan.files) {
      const response = await sourceApp.request(
        `/api/v1/workspace-exports/${plan.exportId}/files/${file.fileId}`,
      );
      expect(response.status).toBe(200);
      payloads.set(file.path, new Uint8Array(await response.arrayBuffer()));
    }
    const { sourceWorkspaceId: _sourceWorkspaceId, ...portableSource } =
      plan.source;
    const manifest = createWorkspaceBundleManifest({
      schemaVersion: 1,
      kind: "clash.workspace.bundle",
      source: portableSource,
      content: plan.content,
      semanticRequirements: plan.semanticRequirements,
      files: plan.files.map(({ fileId: _fileId, ...file }) => file),
      excluded: [],
    });

    const targetDataDir = await mkdtemp(
      join(tmpdir(), "clash-workspace-import-routes-"),
    );
    roots.push(targetDataDir);
    let installedSnapshot: Uint8Array | undefined;
    const targetApp = createLocalApiApp({
      dataDir: targetDataDir,
      userId: "receiver-local-user",
      workspaceProjectAuthority: {
        inspect: async <T>(
          _projectId: string,
          read: (candidate: LoroDoc) => T | Promise<T>,
        ) => read(new LoroDoc()),
      },
      workspaceImportAuthority: {
        reconcileCommittedImport: async () => undefined,
        install: async (
          _projectId,
          _reservationId,
          snapshot,
          commitReceiverAuthority,
        ) => {
          installedSnapshot = snapshot.slice();
          return commitReceiverAuthority();
        },
      },
    });
    const idempotencyKey = `workspace-import:${manifest.integrity.bundleDigest}`;
    const started = await targetApp.request("/api/v1/workspace-imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        kind: "clash.workspace.import-start",
        idempotencyKey,
        bundleDigest: manifest.integrity.bundleDigest,
        manifest,
      }),
    });
    expect(started.status, await started.clone().text()).toBe(201);
    const session = (await started.json()) as {
      importId: string;
      files: Array<{ fileId: string; path: string; state: string }>;
    };
    for (const slot of session.files) {
      const uploaded = await targetApp.request(
        `/api/v1/workspace-imports/${session.importId}/files/${slot.fileId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: payloads.get(slot.path)!.slice().buffer as ArrayBuffer,
        },
      );
      expect(uploaded.status, await uploaded.clone().text()).toBe(200);
    }
    const status = await targetApp.request(
      `/api/v1/workspace-imports/${session.importId}`,
    );
    expect(status.status).toBe(200);
    expect(
      ((await status.json()) as { files: Array<{ state: string }> }).files,
    ).toEqual([expect.objectContaining({ state: "present" })]);

    const committed = await targetApp.request(
      `/api/v1/workspace-imports/${session.importId}/commit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          kind: "clash.workspace.import-commit",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
        }),
      },
    );
    expect(committed.status, await committed.clone().text()).toBe(200);
    expect(await committed.json()).toMatchObject({
      status: "committed",
      target: { projectId: "project-route" },
    });
    expect(installedSnapshot).toBeDefined();
    const restored = new LoroDoc();
    restored.import(installedSnapshot!);
    expect(
      (await createLocalMetadataStore(targetDataDir).load()).projects,
    ).toEqual([
      expect.objectContaining({
        id: "project-route",
        ownerId: "receiver-local-user",
        name: "Route Project",
      }),
    ]);
  });
});
