import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalGlobalAssetService } from "./local-global-assets.js";
import { createLocalResourceStore } from "./local-resource-store.js";

const temporaryDirectories: string[] = [];

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "clash-global-assets-"));
  temporaryDirectories.push(dataDir);
  const service = createLocalGlobalAssetService({
    dataDir,
    projectionOrigin: "http://127.0.0.1:49152",
  });
  return { dataDir, service };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local Global Asset library", () => {
  it("keeps library membership and lifecycle independent while deduplicating Resource bytes", async () => {
    const { service } = await fixture();
    const bytes = new TextEncoder().encode("same immutable image");
    const first = await service.importBytes({
      libraryId: "personal",
      globalAssetId: "global:first",
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "first.png",
      metadata: { width: 64, height: 32 },
      provenance: { kind: "import" },
    });
    const second = await service.importBytes({
      libraryId: "team",
      globalAssetId: "global:second",
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "second.png",
      provenance: { kind: "import" },
    });

    const firstProjection = await service.openProjection("personal", first.id);
    const secondProjection = await service.openProjection("team", second.id);
    expect(firstProjection.resource.id).toBe(secondProjection.resource.id);
    expect(firstProjection.path).toBe(secondProjection.path);

    await service.trash({
      libraryId: "personal",
      globalAssetId: first.id,
      deleteOperationId: "delete:first",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });
    await expect(service.read("personal", first.id)).resolves.toMatchObject({
      id: first.id,
      status: "unavailable",
    });
    await expect(service.read("team", second.id)).resolves.toMatchObject({
      id: second.id,
      status: "ready",
    });
    await expect(service.list("personal")).resolves.toHaveLength(1);
    await expect(service.list("team")).resolves.toHaveLength(1);
  });

  it("returns one storage-neutral ResolvedAsset shape and persists across Host restarts", async () => {
    const { dataDir, service } = await fixture();
    const bytes = new TextEncoder().encode("audio bytes");
    await service.importBytes({
      libraryId: "library-a",
      globalAssetId: "global:audio",
      kind: "audio",
      bytes,
      contentType: "audio/mpeg",
      originalName: "voice.mp3",
      metadata: { durationMs: 2_000 },
    });

    const restarted = createLocalGlobalAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
    });
    const resolved = await restarted.read("library-a", "global:audio");
    expect(resolved).toEqual({
      id: "global:audio",
      kind: "audio",
      name: "voice.mp3",
      metadata: {
        durationMs: 2_000,
        bytes: bytes.byteLength,
        contentType: "audio/mpeg",
        originalName: "voice.mp3",
      },
      lifecycle: { state: "active" },
      status: "ready",
      url: "http://127.0.0.1:49152/api/v1/libraries/library-a/assets/global%3Aaudio/media",
      thumbnailUrl:
        "http://127.0.0.1:49152/api/v1/libraries/library-a/assets/global%3Aaudio/media",
    });
    expect(JSON.stringify(resolved)).not.toMatch(
      /resourceId|storageKey|signedUrl|srcR2Key|path/,
    );
  });

  it("publishes another Global identity from an existing immutable Resource", async () => {
    const { dataDir, service } = await fixture();
    const resources = createLocalResourceStore({ dataDir });
    const installed = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("video bytes"),
      contentType: "video/mp4",
      originalName: "source.mp4",
    });

    const resolved = await service.publishResource({
      libraryId: "library-a",
      globalAssetId: "global:published",
      resourceId: installed.resource.id,
      kind: "video",
      name: "Published",
      metadata: { durationMs: 1_000 },
      provenance: { kind: "admission" },
    });

    expect(resolved).toMatchObject({
      id: "global:published",
      kind: "video",
      name: "Published",
      metadata: {
        durationMs: 1_000,
        bytes: installed.resource.byteLength,
        contentType: "video/mp4",
      },
      provenance: { kind: "admission" },
      status: "ready",
    });
    expect((await service.openProjection("library-a", resolved.id)).path).toBe(
      installed.path,
    );
  });

  it("fails closed when equal-length Resource bytes no longer match their CAS digest", async () => {
    const { service } = await fixture();
    await service.importBytes({
      libraryId: "library-a",
      globalAssetId: "global:tampered",
      kind: "image",
      bytes: new TextEncoder().encode("original"),
      contentType: "image/png",
    });
    const projection = await service.openProjection(
      "library-a",
      "global:tampered",
    );
    await chmod(projection.path, 0o600);
    await writeFile(projection.path, new TextEncoder().encode("tampered"));

    await expect(
      service.read("library-a", "global:tampered"),
    ).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("digest"),
    });
    await expect(
      service.openProjection("library-a", "global:tampered"),
    ).rejects.toThrow(/digest/);
  });

  it("persists purge as a logical tombstone without physically reclaiming shared bytes", async () => {
    const { service } = await fixture();
    const created = await service.importBytes({
      libraryId: "library-a",
      globalAssetId: "global:purged",
      kind: "image",
      bytes: new TextEncoder().encode("retained bytes"),
      contentType: "image/png",
    });
    const projection = await service.openProjection("library-a", created.id);
    await service.trash({
      libraryId: "library-a",
      globalAssetId: created.id,
      deleteOperationId: "delete:purge",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });
    await service.purge({
      libraryId: "library-a",
      globalAssetId: created.id,
      deleteOperationId: "delete:purge",
      purgedAt: "2026-08-21T00:00:00.000Z",
    });

    expect((await stat(projection.path)).isFile()).toBe(true);
    await expect(readFile(projection.path, "utf8")).resolves.toBe(
      "retained bytes",
    );
    await expect(service.read("library-a", created.id)).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(service.restore("library-a", created.id)).rejects.toThrow(
      /purged/,
    );
  });
});
