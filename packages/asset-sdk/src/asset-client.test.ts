import { describe, expect, it, vi } from "vitest";

import type {
  ActionAssetBinding,
  ProjectAssetEntry,
  Resource,
} from "@clash/shared-types";
import {
  AssetSdkContractError,
  createAssetClient,
  resolveProjectAsset,
  type ProjectAssetAuthorityPort,
  type ResourceProjectionPort,
  type ResourceRegistryPort,
} from "./index.js";

const entry = (id = "asset-1"): ProjectAssetEntry => ({
  id,
  kind: "image",
  source: { kind: "owned", resourceId: `resource-${id}` },
  lifecycle: { state: "active" },
  name: `Asset ${id}`,
  metadata: { width: 1024, height: 768, contentType: "image/png" },
});

const resource = (id = "resource-asset-1"): Resource => ({
  id,
  kind: "image",
  digest: { algorithm: "sha256", value: "a".repeat(64) },
  byteLength: 42,
  contentType: "image/png",
});

const actionBinding = (id = "binding-1"): ActionAssetBinding => ({
  id,
  owner: { kind: "draft", actionId: "action-1" },
  direction: "input",
  slot: `reference:${id}`,
  projectAssetId: "asset-1",
  role: "reference",
});

function ports(
  overrides: {
    registry?: Partial<ResourceRegistryPort>;
    projection?: Partial<ResourceProjectionPort>;
  } = {},
) {
  const registry: ResourceRegistryPort = {
    resolve: vi.fn(async ({ entry: value }) => ({
      status: "ready" as const,
      resource: resource(value.source.resourceId),
    })),
    ...overrides.registry,
  };
  const projection: ResourceProjectionPort = {
    resolve: vi.fn(async () => ({
      status: "ready" as const,
      url: "https://host.example/assets/asset-1",
      thumbnailUrl: "https://host.example/thumbnails/asset-1",
    })),
    ...overrides.projection,
  };
  return { registry, projection };
}

describe("resolveProjectAsset", () => {
  it("builds the one shared read-only ResolvedAsset shape", async () => {
    const adapters = ports();

    await expect(
      resolveProjectAsset(adapters, {
        projectId: "project-1",
        entry: entry(),
      }),
    ).resolves.toEqual({
      id: "asset-1",
      kind: "image",
      name: "Asset asset-1",
      metadata: { width: 1024, height: 768, contentType: "image/png" },
      lifecycle: { state: "active" },
      status: "ready",
      url: "https://host.example/assets/asset-1",
      thumbnailUrl: "https://host.example/thumbnails/asset-1",
    });
    expect(adapters.registry.resolve).toHaveBeenCalledWith({
      projectId: "project-1",
      entry: entry(),
      intent: "read",
    });
  });

  it.each([
    [
      { status: "uploading", resource: resource(), progress: 0.25 },
      { status: "uploading", progress: 0.25 },
    ],
    [
      { status: "unavailable", error: "not replicated" },
      { status: "unavailable", error: "not replicated" },
    ],
    [
      { status: "failed", error: "digest mismatch" },
      { status: "failed", error: "digest mismatch" },
    ],
  ] as const)(
    "maps registry state %o without asking for a projection",
    async (resolution, expected) => {
      const adapters = ports({
        registry: { resolve: vi.fn(async () => resolution) },
      });

      await expect(
        resolveProjectAsset(adapters, {
          projectId: "project-1",
          entry: entry(),
        }),
      ).resolves.toMatchObject(expected);
      expect(adapters.projection.resolve).not.toHaveBeenCalled();
    },
  );

  it("rejects a registry result for a different immutable Resource", async () => {
    const adapters = ports({
      registry: {
        resolve: vi.fn(async () => ({
          status: "ready" as const,
          resource: resource("wrong"),
        })),
      },
    });

    await expect(
      resolveProjectAsset(adapters, {
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({
      code: "RESOURCE_CONTRACT_VIOLATION",
    });
  });

  it.each([
    [{ bytes: 41, contentType: "image/png" }, /byte length/i],
    [{ bytes: 42, contentType: "image/jpeg" }, /content type/i],
  ] as const)(
    "rejects Project metadata that contradicts immutable Resource facts: %o",
    async (metadata, message) => {
      const adapters = ports();
      await expect(
        resolveProjectAsset(adapters, {
          projectId: "project-1",
          entry: { ...entry(), metadata },
        }),
      ).rejects.toMatchObject({
        code: "RESOURCE_CONTRACT_VIOLATION",
        message: expect.stringMatching(message),
      });
      expect(adapters.projection.resolve).not.toHaveBeenCalled();
    },
  );

  it("does not project a trashed entry as readable media", async () => {
    const adapters = ports();
    const trashed: ProjectAssetEntry = {
      ...entry(),
      lifecycle: {
        state: "trashed",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      },
    };

    await expect(
      resolveProjectAsset(adapters, {
        projectId: "project-1",
        entry: trashed,
      }),
    ).resolves.toMatchObject({
      lifecycle: { state: "trashed" },
      status: "unavailable",
    });
    expect(adapters.registry.resolve).not.toHaveBeenCalled();
  });
});

describe("semantic Asset client", () => {
  function clientFixture() {
    const stored = new Map<string, ProjectAssetEntry>();
    const storedBindings = new Map<string, ActionAssetBinding>();
    const authority: ProjectAssetAuthorityPort = {
      read: vi.fn(async (_projectId, id) => stored.get(id) ?? null),
      list: vi.fn(async () =>
        [...stored.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      create: vi.fn(async (_projectId, value) => {
        stored.set(value.id, value);
        return value;
      }),
      trashIfUnreferenced: vi.fn(async (_projectId, input) => {
        const references = [...storedBindings.values()]
          .filter((value) => value.projectAssetId === input.id)
          .sort((left, right) => left.id.localeCompare(right.id));
        if (references.length > 0) {
          return {
            ok: false as const,
            error: {
              code: "ASSET_IN_USE" as const,
              projectAssetId: input.id,
              references,
            },
          };
        }
        const value = stored.get(input.id)!;
        const next: ProjectAssetEntry = {
          ...value,
          lifecycle: {
            state: "trashed",
            deleteOperationId: input.deleteOperationId,
            deletedAt: input.deletedAt,
            purgeAfter: input.purgeAfter,
          },
        };
        stored.set(input.id, next);
        return { ok: true as const, entry: next };
      }),
      restore: vi.fn(async (_projectId, id) => {
        const next = {
          ...stored.get(id)!,
          lifecycle: { state: "active" as const },
        };
        stored.set(id, next);
        return next;
      }),
      purge: vi.fn(async (_projectId, input) => {
        const value = stored.get(input.id)!;
        if (value.lifecycle.state !== "trashed") throw new Error("not trashed");
        const next: ProjectAssetEntry = {
          ...value,
          lifecycle: {
            state: "purged",
            deleteOperationId: input.deleteOperationId,
            deletedAt: value.lifecycle.deletedAt,
            purgedAt: input.purgedAt,
          },
        };
        stored.set(input.id, next);
        return next;
      }),
      bind: vi.fn(async (_projectId, value) => {
        storedBindings.set(value.id, value);
        return value;
      }),
      unbind: vi.fn(async (_projectId, id) => {
        const value = storedBindings.get(id) ?? null;
        storedBindings.delete(id);
        return value;
      }),
      listReferences: vi.fn(async (_projectId, projectAssetId) =>
        [...storedBindings.values()]
          .filter((value) => value.projectAssetId === projectAssetId)
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    };
    const adapters = ports();
    return {
      authority,
      adapters,
      client: createAssetClient({ authority, ...adapters }),
    };
  }

  it("reads and lists through the same resolver", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry("asset-b"),
    });
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry("asset-a"),
    });

    await expect(
      fixture.client.read({
        projectId: "project-1",
        projectAssetId: "asset-a",
      }),
    ).resolves.toMatchObject({ id: "asset-a", status: "ready" });
    await expect(
      fixture.client.list({ projectId: "project-1" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "asset-a" }),
      expect.objectContaining({ id: "asset-b" }),
    ]);
  });

  it("creates owned and admitted linked entries without storage write fields", async () => {
    const fixture = clientFixture();
    const linked: ProjectAssetEntry = {
      ...entry("linked-1"),
      source: {
        kind: "linked",
        resourceId: "resource-linked-1",
        origin: { scope: "global", entryId: "global-1" },
      },
    };

    await expect(
      fixture.client.createOwned({ projectId: "project-1", entry: entry() }),
    ).resolves.toEqual(entry());
    await expect(
      fixture.client.admitLinked({ projectId: "project-1", entry: linked }),
    ).resolves.toEqual(linked);
    expect(fixture.adapters.registry.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "create-owned",
      }),
    );
    expect(fixture.adapters.registry.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "admit-linked",
      }),
    );

    const invalid = { ...entry("bad"), url: "https://write.example/forbidden" };
    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: invalid as never,
      }),
    ).rejects.toBeInstanceOf(AssetSdkContractError);
  });

  it("refuses the wrong semantic creation path", async () => {
    const fixture = clientFixture();
    const linked: ProjectAssetEntry = {
      ...entry("linked-1"),
      source: {
        kind: "linked",
        resourceId: "resource-linked-1",
        origin: { scope: "catalog", entryId: "catalog-1" },
      },
    };

    await expect(
      fixture.client.createOwned({ projectId: "project-1", entry: linked }),
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_ASSET" });
    await expect(
      fixture.client.admitLinked({ projectId: "project-1", entry: entry() }),
    ).rejects.toMatchObject({ code: "INVALID_PROJECT_ASSET" });
  });

  it("does not publish Project state when Resource admission fails", async () => {
    const fixture = clientFixture();
    fixture.adapters.registry.resolve = vi.fn(async () => ({
      status: "failed" as const,
      error: "digest verification failed",
    }));

    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
    expect(fixture.authority.create).not.toHaveBeenCalled();
  });

  it("does not publish Project state while Resource installation is still uploading", async () => {
    const fixture = clientFixture();
    fixture.adapters.registry.resolve = vi.fn(async ({ entry: value }) => ({
      status: "uploading" as const,
      resource: resource(value.source.resourceId),
      progress: 0.9,
    }));

    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_READY" });
    expect(fixture.authority.create).not.toHaveBeenCalled();
  });

  it("does not let a Registry adapter mutate the requested Project identity", async () => {
    const fixture = clientFixture();
    fixture.adapters.registry.resolve = vi.fn(async ({ entry: value }) => {
      if (value.source.kind === "owned")
        value.source.resourceId = "resource-swapped";
      return {
        status: "ready" as const,
        resource: resource("resource-swapped"),
      };
    });
    const requested = entry();

    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: requested,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONTRACT_VIOLATION" });
    expect(requested.source.resourceId).toBe("resource-asset-1");
    expect(fixture.authority.create).not.toHaveBeenCalled();
  });

  it("rejects an authority create result that changes immutable identity", async () => {
    const fixture = clientFixture();
    fixture.authority.create = vi.fn(async (_projectId, value) => ({
      ...value,
      source: { kind: "owned", resourceId: "resource-from-other-writer" },
    }));

    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });

  it("keeps an independent request snapshot when authority.create mutates its input", async () => {
    const fixture = clientFixture();
    fixture.authority.create = vi.fn(async (_projectId, value) => {
      if (value.source.kind === "owned")
        value.source.resourceId = "resource-authority-swapped";
      return value;
    });

    await expect(
      fixture.client.createOwned({
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });

  it("uses semantic lifecycle operations rather than deleting storage", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry(),
    });

    await expect(
      fixture.client.trash({
        projectId: "project-1",
        projectAssetId: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ lifecycle: { state: "trashed" } });
    await expect(
      fixture.client.restore({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    ).resolves.toMatchObject({ lifecycle: { state: "active" } });
    await fixture.client.trash({
      projectId: "project-1",
      projectAssetId: "asset-1",
      deleteOperationId: "delete-2",
      deletedAt: "2026-08-21T00:00:00.000Z",
      purgeAfter: "2026-08-28T00:00:00.000Z",
    });
    await expect(
      fixture.client.purge({
        projectId: "project-1",
        projectAssetId: "asset-1",
        deleteOperationId: "delete-2",
        purgedAt: "2026-08-29T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ lifecycle: { state: "purged" } });
  });

  it("forwards opaque observations to the authority that owns atomic CAS", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry(),
    });
    const observation = {
      actorClientType: "agent",
      expectedReadToken: "project-asset-v1:0123456789abcdef:receipt:signed",
    };

    await fixture.client.trash({
      projectId: "project-1",
      projectAssetId: "asset-1",
      deleteOperationId: "delete-cas",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
      observation,
    });
    expect(fixture.authority.trashIfUnreferenced).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({ id: "asset-1" }),
      observation,
    );

    await fixture.client.restore({
      projectId: "project-1",
      projectAssetId: "asset-1",
      observation,
    });
    expect(fixture.authority.restore).toHaveBeenLastCalledWith(
      "project-1",
      "asset-1",
      observation,
    );
  });

  it("binds, lists references and explicitly unbinds through the Project authority", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry(),
    });

    await expect(
      fixture.client.bind({
        projectId: "project-1",
        binding: actionBinding("binding-b"),
      }),
    ).resolves.toEqual(actionBinding("binding-b"));
    await expect(
      fixture.client.bind({
        projectId: "project-1",
        binding: actionBinding("binding-a"),
      }),
    ).resolves.toEqual(actionBinding("binding-a"));
    await expect(
      fixture.client.listReferences({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    ).resolves.toEqual([
      actionBinding("binding-a"),
      actionBinding("binding-b"),
    ]);
    await expect(
      fixture.client.unbind({
        projectId: "project-1",
        bindingId: "binding-a",
      }),
    ).resolves.toEqual(actionBinding("binding-a"));
  });

  it("returns structured ASSET_IN_USE from the atomic trash operation", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry(),
    });
    await fixture.client.bind({
      projectId: "project-1",
      binding: actionBinding(),
    });

    await expect(
      fixture.client.trash({
        projectId: "project-1",
        projectAssetId: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ASSET_IN_USE",
      projectAssetId: "asset-1",
      references: [actionBinding()],
    });
    expect(fixture.authority.trashIfUnreferenced).toHaveBeenCalledOnce();
  });

  it("preserves a fail-closed binding authority response as a client error", async () => {
    const fixture = clientFixture();
    await fixture.client.createOwned({
      projectId: "project-1",
      entry: entry(),
    });
    fixture.authority.trashIfUnreferenced = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "ACTION_ASSET_BINDING_AUTHORITY_REQUIRED" as const,
        message: "Legacy Action Asset references have not been materialized.",
        requiredVersion: 1 as const,
      },
    }));

    await expect(
      fixture.client.trash({
        projectId: "project-1",
        projectAssetId: "asset-1",
        deleteOperationId: "delete-before-binding-cutover",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACTION_ASSET_BINDING_AUTHORITY_REQUIRED",
      projectAssetId: "asset-1",
    });
  });

  it("keeps an independent binding snapshot across a mutating authority adapter", async () => {
    const fixture = clientFixture();
    fixture.authority.bind = vi.fn(async (_projectId, value) => {
      value.projectAssetId = "asset-swapped";
      return value;
    });

    await expect(
      fixture.client.bind({
        projectId: "project-1",
        binding: actionBinding(),
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });

  it("rejects lifecycle adapters that do not satisfy the requested postcondition", async () => {
    const fixture = clientFixture();
    fixture.authority.trashIfUnreferenced = vi.fn(async () => ({
      ok: true,
      entry: entry(),
    }));

    await expect(
      fixture.client.trash({
        projectId: "project-1",
        projectAssetId: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });

    fixture.authority.restore = vi.fn(async () => ({
      ...entry(),
      lifecycle: {
        state: "trashed",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      },
    }));
    await expect(
      fixture.client.restore({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });

  it("sorts list results at the SDK boundary even when the authority does not", async () => {
    const fixture = clientFixture();
    fixture.authority.list = vi.fn(async () => [
      entry("asset-b"),
      entry("asset-a"),
    ]);

    await expect(
      fixture.client.list({ projectId: "project-1" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "asset-a" }),
      expect.objectContaining({ id: "asset-b" }),
    ]);
  });

  it("rejects malformed authority output instead of creating a second Asset shape", async () => {
    const fixture = clientFixture();
    fixture.authority.read = vi.fn(
      async () =>
        ({
          ...entry(),
          storageKey: "forbidden/object/key",
        }) as never,
    );

    await expect(
      fixture.client.read({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_CONTRACT_VIOLATION" });
  });

  it("rejects malformed projection output instead of leaking it to consumers", async () => {
    const fixture = clientFixture();
    fixture.authority.read = vi.fn(async () => entry());
    fixture.adapters.projection.resolve = vi.fn(
      async () =>
        ({
          status: "ready",
          url: "not a url",
        }) as never,
    );

    await expect(
      fixture.client.read({
        projectId: "project-1",
        projectAssetId: "asset-1",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_CONTRACT_VIOLATION" });
  });

  it("rejects invalid transfer progress from a registry adapter", async () => {
    const adapters = ports({
      registry: {
        resolve: vi.fn(
          async () =>
            ({
              status: "uploading",
              resource: resource(),
              progress: 2,
            }) as never,
        ),
      },
    });

    await expect(
      resolveProjectAsset(adapters, {
        projectId: "project-1",
        entry: entry(),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONTRACT_VIOLATION" });
  });
});
