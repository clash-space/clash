import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createLocalMetadataStore } from "./local-metadata-store";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-local-metadata-store-"));
}

describe("local metadata store", () => {
  it("round-trips soft-deleted project metadata", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.save({
      projects: [
        {
          id: "project-deleted",
          ownerId: "local-user",
          name: "Deleted Project",
          description: null,
          createdAt: "2026-07-07T00:00:00.000Z",
          updatedAt: "2026-07-07T00:01:00.000Z",
          deletedAt: "2026-07-07T00:02:00.000Z",
          assets: [],
        },
      ],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.load()).resolves.toMatchObject({
      projects: [
        {
          id: "project-deleted",
          deletedAt: "2026-07-07T00:02:00.000Z",
        },
      ],
    });
  });

  it("resolves asset storage keys only through the requesting project's refs", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.save({
      projects: [],
      assets: [
        {
          id: "asset-shared-id",
          userId: "local-user",
          kind: "image",
          srcR2Key: "projects/project-a/images/frame.png",
          coverR2Key: null,
          metadata: null,
          sourceModel: null,
          sourcePrompt: null,
          sourceTaskId: null,
          sources: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      assetRefs: [
        { assetId: "asset-shared-id", projectId: "project-a", importedAt: 1 },
      ],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.resolveStorageKeys("project-a", ["asset-shared-id"])).resolves.toEqual([
      "projects/project-a/images/frame.png",
    ]);
    await expect(store.resolveStorageKeys("project-b", ["asset-shared-id"])).resolves.toEqual([]);
  });
});
