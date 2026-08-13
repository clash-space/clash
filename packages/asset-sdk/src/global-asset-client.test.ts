import { describe, expect, it, vi } from "vitest";

import type { GlobalAssetEntry, Resource } from "@clash/shared-types";
import {
  createGlobalAssetClient,
  type GlobalAssetAuthorityPort,
} from "./index.js";

const globalEntry = (id = "global-1"): GlobalAssetEntry => ({
  id,
  kind: "image",
  resourceId: `resource-${id}`,
  lifecycle: { state: "active" },
  name: `Global ${id}`,
  metadata: { width: 1024, height: 768, bytes: 4, contentType: "image/png" },
});

const resourceFor = (entry: GlobalAssetEntry): Resource => ({
  id: entry.resourceId,
  kind: entry.kind,
  digest: { algorithm: "sha256", value: "a".repeat(64) },
  byteLength: 4,
  contentType: "image/png",
});

function fixture() {
  const stored = new Map<string, GlobalAssetEntry>();
  const authority: GlobalAssetAuthorityPort = {
    read: vi.fn(
      async (libraryId, id) => stored.get(`${libraryId}:${id}`) ?? null,
    ),
    list: vi.fn(async (libraryId) =>
      [...stored.entries()]
        .filter(([key]) => key.startsWith(`${libraryId}:`))
        .map(([, entry]) => entry)
        .reverse(),
    ),
    create: vi.fn(async (libraryId, entry) => {
      stored.set(`${libraryId}:${entry.id}`, entry);
      return entry;
    }),
    trash: vi.fn(async (libraryId, input) => {
      const key = `${libraryId}:${input.id}`;
      const current = stored.get(key)!;
      const entry: GlobalAssetEntry = {
        ...current,
        lifecycle: {
          state: "trashed",
          deleteOperationId: input.deleteOperationId,
          deletedAt: input.deletedAt,
          purgeAfter: input.purgeAfter,
        },
      };
      stored.set(key, entry);
      return entry;
    }),
    restore: vi.fn(async (libraryId, id) => {
      const key = `${libraryId}:${id}`;
      const entry = {
        ...stored.get(key)!,
        lifecycle: { state: "active" as const },
      };
      stored.set(key, entry);
      return entry;
    }),
    purge: vi.fn(async (libraryId, input) => {
      const key = `${libraryId}:${input.id}`;
      const current = stored.get(key)!;
      if (current.lifecycle.state !== "trashed") throw new Error("not trashed");
      const entry: GlobalAssetEntry = {
        ...current,
        lifecycle: {
          state: "purged",
          deleteOperationId: input.deleteOperationId,
          deletedAt: current.lifecycle.deletedAt,
          purgedAt: input.purgedAt,
        },
      };
      stored.set(key, entry);
      return entry;
    }),
  };
  const client = createGlobalAssetClient({
    authority,
    registry: {
      resolve: vi.fn(async ({ entry }) => ({
        status: "ready" as const,
        resource: resourceFor(entry),
      })),
    },
    projection: {
      resolve: vi.fn(async ({ libraryId, entry }) => ({
        status: "ready" as const,
        url: `http://host.invalid/${libraryId}/${entry.id}`,
      })),
    },
  });
  return { authority, client };
}

describe("Global Asset client", () => {
  it("scopes authority rows by library and exposes only the unified ResolvedAsset view", async () => {
    const value = fixture();
    await value.client.create({
      libraryId: "library-1",
      entry: globalEntry("global-a"),
    });
    await value.client.create({
      libraryId: "library-1",
      entry: globalEntry("global-b"),
    });
    await value.client.create({
      libraryId: "library-2",
      entry: globalEntry("global-a"),
    });

    await expect(
      value.client.list({ libraryId: "library-1" }),
    ).resolves.toEqual([
      {
        id: "global-a",
        kind: "image",
        name: "Global global-a",
        metadata: {
          width: 1024,
          height: 768,
          bytes: 4,
          contentType: "image/png",
        },
        lifecycle: { state: "active" },
        status: "ready",
        url: "http://host.invalid/library-1/global-a",
      },
      {
        id: "global-b",
        kind: "image",
        name: "Global global-b",
        metadata: {
          width: 1024,
          height: 768,
          bytes: 4,
          contentType: "image/png",
        },
        lifecycle: { state: "active" },
        status: "ready",
        url: "http://host.invalid/library-1/global-b",
      },
    ]);
    expect(
      JSON.stringify(
        await value.client.read({
          libraryId: "library-1",
          globalAssetId: "global-a",
        }),
      ),
    ).not.toMatch(/resourceId|storageKey|signedUrl|path/);
  });

  it("keeps logical lifecycle independent from immutable Resource availability", async () => {
    const value = fixture();
    await value.client.create({ libraryId: "library-1", entry: globalEntry() });
    await value.client.trash({
      libraryId: "library-1",
      globalAssetId: "global-1",
      deleteOperationId: "delete-1",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });
    await expect(
      value.client.read({
        libraryId: "library-1",
        globalAssetId: "global-1",
      }),
    ).resolves.toMatchObject({
      lifecycle: { state: "trashed" },
      status: "unavailable",
    });
    await value.client.restore({
      libraryId: "library-1",
      globalAssetId: "global-1",
    });
    await expect(
      value.client.read({
        libraryId: "library-1",
        globalAssetId: "global-1",
      }),
    ).resolves.toMatchObject({
      lifecycle: { state: "active" },
      status: "ready",
    });
  });

  it("refuses publication when Global metadata disagrees with Resource facts", async () => {
    const value = fixture();
    await expect(
      value.client.create({
        libraryId: "library-1",
        entry: {
          ...globalEntry(),
          metadata: { bytes: 5, contentType: "image/png" },
        },
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONTRACT_VIOLATION" });
    expect(value.authority.create).not.toHaveBeenCalled();
  });

  it("rejects an adapter that mutates the requested Global identity", async () => {
    const value = fixture();
    value.authority.create = vi.fn(async (_libraryId, entry) => ({
      ...entry,
      resourceId: "resource-swapped",
    }));

    await expect(
      value.client.create({
        libraryId: "library-1",
        entry: globalEntry(),
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });
});
