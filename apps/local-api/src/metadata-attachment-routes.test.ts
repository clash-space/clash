import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalApiApp } from "./app";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-metadata-target-route-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const descriptionIdentity = {
  schemaVersion: 1,
  kind: "media.description",
  text: "A presenter introduces the cut.",
  sourceHash: `sha256:${"a".repeat(64)}`,
};

describe("typed metadata attachment routes", () => {
  it("validates the identity through its declared metadata schema", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const response = await app.request("/api/v1/local/asset-metadata", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "attach-invalid",
        target: {
          kind: "project-asset",
          projectId: "project-1",
          assetId: "asset-1",
        },
        metadataKind: "media.description",
        producer: "route-test",
        metadata: {
          schemaVersion: 1,
          kind: "media.description",
          text: "",
          sourceHash: "not-a-content-hash",
        },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("indexes complete ProjectAsset and ActionRevision targets without collisions", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const targets = [
      {
        kind: "project-asset",
        projectId: "project-1",
        assetId: "shared-id",
      },
      {
        kind: "action-revision",
        projectId: "project-1",
        actionId: "shared-id",
        actionRevisionId: "revision-1",
      },
    ] as const;

    for (const target of targets) {
      const response = await app.request("/api/v1/local/asset-metadata", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: `attach-${target.kind}`,
          target,
          metadataKind: "media.description",
          producer: "route-test",
          metadata: descriptionIdentity,
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        recorded: true,
        authority: "projection-index",
        target,
        metadataKind: "media.description",
      });
    }

    const listed = await app.request(
      "/api/v1/local/asset-metadata?projectId=project-1&kind=media.description",
    );
    expect(listed.status).toBe(200);
    const payload = (await listed.json()) as { metadata: unknown[] };
    expect(payload.metadata).toHaveLength(2);
    expect(payload.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: targets[0] }),
        expect.objectContaining({ target: targets[1] }),
      ]),
    );
  });

  it("rejects legacy assetId writes and storage-bearing targets", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const legacy = await app.request("/api/v1/local/asset-metadata", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "attach-legacy",
        assetId: "asset-1",
        projectId: "project-1",
        metadataKind: "media.description",
        producer: "route-test",
        identity: descriptionIdentity,
      }),
    });
    expect(legacy.status).toBe(400);

    const storageBearing = await app.request("/api/v1/local/asset-metadata", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "attach-storage-bearing",
        target: {
          kind: "project-asset",
          projectId: "project-1",
          assetId: "asset-1",
          storageKey: "private/project-1/asset-1.mov",
        },
        assetId: "asset-1",
        metadataKind: "media.description",
        producer: "route-test",
        identity: descriptionIdentity,
      }),
    });
    expect(storageBearing.status).toBe(400);
  });
});
