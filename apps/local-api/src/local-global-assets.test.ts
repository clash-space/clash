import { createHash } from "node:crypto";
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

import { createLocalAssetInspectionService } from "./local-asset-inspections.js";
import { createLocalGlobalAssetService } from "./local-global-assets.js";
import {
  createLocalResourceStore,
  resourceIdForSha256,
} from "./local-resource-store.js";

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
  it("stores Host-inspected media facts in the Global authority before returning an import", async () => {
    const { dataDir } = await fixture();
    const bytes = new TextEncoder().encode("Host-inspected Global video");
    const assetInspection = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async ({ resource }) => ({
        width: 1_920,
        height: 1_080,
        durationMs: 2_500,
        frameRate: 24,
        videoCodec: "h264",
        hasAudio: true,
        audioCodec: "aac",
        contentType: resource.contentType,
      }),
    });
    const service = createLocalGlobalAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      assetInspection,
    });

    await service.importBytes({
      libraryId: "personal",
      globalAssetId: "global:inspected-video",
      kind: "video",
      bytes,
      contentType: "video/mp4",
      originalName: "clip.mp4",
      metadata: {},
      provenance: { kind: "import" },
    });

    await expect(
      service.readEntry("personal", "global:inspected-video"),
    ).resolves.toMatchObject({
      metadata: {
        width: 1_920,
        height: 1_080,
        durationMs: 2_500,
        frameRate: 24,
        videoCodec: "h264",
        audioCodec: "aac",
        bytes: bytes.byteLength,
        contentType: "video/mp4",
        originalName: "clip.mp4",
      },
    });
  });

  it("does not publish caller waveform samples as canonical Global metadata", async () => {
    const { dataDir } = await fixture();
    const assetInspection = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async ({ resource }) => ({
        durationMs: 1_000,
        contentType: resource.contentType,
        hasAudio: true,
        audioCodec: "aac",
      }),
    });
    const service = createLocalGlobalAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      assetInspection,
    });

    await service.importBytes({
      libraryId: "personal",
      globalAssetId: "global:legacy-waveform",
      kind: "audio",
      bytes: new TextEncoder().encode("audio with client waveform"),
      contentType: "audio/aac",
      metadata: { waveform: [0.1, 0.4, 0.2] },
    });

    const entry = await service.readEntry("personal", "global:legacy-waveform");
    expect(entry?.metadata).toMatchObject({
      durationMs: 1_000,
      hasAudio: true,
      audioCodec: "aac",
    });
    expect(entry?.metadata).not.toHaveProperty("waveform");
  });

  it("reuses one versioned Resource inspection across idempotent Global publication retries", async () => {
    const { dataDir } = await fixture();
    let probes = 0;
    const assetInspection = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        return {
          width: 1_280,
          height: 720,
          durationMs: 1_500,
          frameRate: 30,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });
    const service = createLocalGlobalAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      assetInspection,
    });
    const resources = createLocalResourceStore({ dataDir });
    const installed = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("one reusable Global Resource"),
      contentType: "video/mp4",
      originalName: "reusable.mp4",
    });
    const publish = () =>
      service.publishResource({
        libraryId: "personal",
        globalAssetId: "global:publication-retry",
        resourceId: installed.resource.id,
        kind: "video",
        name: "Reusable",
        metadata: {},
        provenance: { kind: "admission" },
      });

    const first = await publish();
    const retried = await publish();

    expect(retried).toEqual(first);
    expect(probes).toBe(1);
    await expect(
      service.readEntry("personal", "global:publication-retry"),
    ).resolves.toMatchObject({
      metadata: {
        width: 1_280,
        height: 720,
        durationMs: 1_500,
        frameRate: 30,
        videoCodec: "h264",
      },
    });
  });

  it("keeps staged CAS bytes but creates no Global entry when Host inspection fails", async () => {
    const { dataDir } = await fixture();
    const bytes = new TextEncoder().encode("temporarily unprobeable video");
    const assetInspection = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        throw new Error("temporary decoder failure");
      },
    });
    const service = createLocalGlobalAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      assetInspection,
    });

    await expect(
      service.importBytes({
        libraryId: "personal",
        globalAssetId: "global:probe-failure",
        kind: "video",
        bytes,
        contentType: "video/mp4",
      }),
    ).rejects.toThrow("temporary decoder failure");
    await expect(
      service.readEntry("personal", "global:probe-failure"),
    ).resolves.toBeNull();

    const digest = createHash("sha256").update(bytes).digest("hex");
    const resource = await createLocalResourceStore({ dataDir }).resolve(
      resourceIdForSha256(digest),
    );
    expect(resource?.resource).toMatchObject({
      kind: "video",
      byteLength: bytes.byteLength,
      contentType: "video/mp4",
    });
  });

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

  it("rejects a stale restore after another consumer restored and trashed a newer delete operation", async () => {
    const { service } = await fixture();
    const created = await service.importBytes({
      libraryId: "personal",
      globalAssetId: "global:restore-cas",
      kind: "image",
      bytes: new TextEncoder().encode("restore CAS image"),
      contentType: "image/png",
    });
    await service.trash({
      libraryId: "personal",
      globalAssetId: created.id,
      deleteOperationId: "delete:operation-1",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });
    const consumerAObservation = await service.read("personal", created.id);
    expect(consumerAObservation?.lifecycle).toEqual({
      state: "trashed",
      deleteOperationId: "delete:operation-1",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });

    await service.restore({
      libraryId: "personal",
      globalAssetId: created.id,
      deleteOperationId: "delete:operation-1",
    });
    await service.trash({
      libraryId: "personal",
      globalAssetId: created.id,
      deleteOperationId: "delete:operation-2",
      deletedAt: "2026-08-14T00:00:00.000Z",
      purgeAfter: "2026-08-21T00:00:00.000Z",
    });

    await expect(
      service.restore({
        libraryId: "personal",
        globalAssetId: created.id,
        deleteOperationId: "delete:operation-1",
      }),
    ).rejects.toMatchObject({ code: "GLOBAL_ASSET_FACT_MISMATCH" });
    await expect(service.read("personal", created.id)).resolves.toMatchObject({
      lifecycle: {
        state: "trashed",
        deleteOperationId: "delete:operation-2",
      },
    });

    await service.restore({
      libraryId: "personal",
      globalAssetId: created.id,
      deleteOperationId: "delete:operation-2",
    });
    await expect(
      service.restore({
        libraryId: "personal",
        globalAssetId: created.id,
        deleteOperationId: "delete:operation-1",
      }),
    ).rejects.toMatchObject({ code: "GLOBAL_ASSET_FACT_MISMATCH" });
  });

  it("replays the same restore operation after its first result is lost", async () => {
    const { service } = await fixture();
    const created = await service.importBytes({
      libraryId: "personal",
      globalAssetId: "global:restore-retry",
      kind: "image",
      bytes: new TextEncoder().encode("restore retry image"),
      contentType: "image/png",
    });
    await service.trash({
      libraryId: "personal",
      globalAssetId: created.id,
      deleteOperationId: "delete:retry",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });
    const restore = () =>
      service.restore({
        libraryId: "personal",
        globalAssetId: created.id,
        deleteOperationId: "delete:retry",
      });

    await restore();
    await expect(restore()).resolves.toMatchObject({
      id: created.id,
      lifecycle: { state: "active" },
    });
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

  it("reuses original image media for thumbnails and leaves video derivation to presentation clients", async () => {
    const { service } = await fixture();
    const image = await service.importBytes({
      libraryId: "library-preview",
      globalAssetId: "global:image-preview",
      kind: "image",
      bytes: new TextEncoder().encode("image bytes"),
      contentType: "image/png",
    });
    const video = await service.importBytes({
      libraryId: "library-preview",
      globalAssetId: "global:video-preview",
      kind: "video",
      bytes: new TextEncoder().encode("video bytes"),
      contentType: "video/mp4",
    });

    expect(image.thumbnailUrl).toBe(image.url);
    expect(video).not.toHaveProperty("thumbnailUrl");
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
    await expect(
      service.restore({
        libraryId: "library-a",
        globalAssetId: created.id,
        deleteOperationId: "delete:purge",
      }),
    ).rejects.toThrow(/purged/);
  });
});
