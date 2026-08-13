import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalFfprobeAssetInspector,
  createLocalAssetInspectionService,
} from "./local-asset-inspections.js";
import { createLocalResourceStore } from "./local-resource-store.js";

const temporaryDirectories: string[] = [];
const nodeRequire = createRequire(import.meta.url);

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "clash-asset-representations-"));
  temporaryDirectories.push(dataDir);
  return {
    dataDir,
    resources: createLocalResourceStore({ dataDir }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Local Asset inspection", () => {
  it("normalizes ffprobe output into Resource inspection facts", async () => {
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async (file, args) => {
        expect(file).toBe("/test/bin/ffprobe");
        expect(args).toEqual([
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_streams",
          "-show_format",
          "/private/source.mp4",
        ]);
        return {
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: "video",
                codec_name: "h264",
                width: 1920,
                height: 1080,
                avg_frame_rate: "30000/1001",
              },
              { codec_type: "audio", codec_name: "aac" },
            ],
            format: {
              format_name: "mov,mp4,m4a,3gp,3g2,mj2",
              duration: "2.501",
            },
          }),
        };
      },
    });

    await expect(
      inspector({
        sourcePath: "/private/source.mp4",
        resource: {
          id: `sha256:${"a".repeat(64)}`,
          kind: "video",
          digest: { algorithm: "sha256", value: "a".repeat(64) },
          byteLength: 42,
          contentType: "video/mp4",
        },
      }),
    ).resolves.toEqual({
      width: 1920,
      height: 1080,
      durationMs: 2_501,
      contentType: "video/mp4",
      frameRate: 30000 / 1001,
      videoCodec: "h264",
      hasAudio: true,
      audioCodec: "aac",
    });
  });

  it("derives a silent-video fact instead of leaving audio presence unknown", async () => {
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => ({
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1280,
              height: 720,
              avg_frame_rate: "24/1",
            },
          ],
          format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.5" },
        }),
      }),
    });

    await expect(
      inspector({
        sourcePath: "/private/silent.mp4",
        resource: {
          id: `sha256:${"b".repeat(64)}`,
          kind: "video",
          digest: { algorithm: "sha256", value: "b".repeat(64) },
          byteLength: 42,
          contentType: "video/mp4",
        },
      }),
    ).resolves.toMatchObject({ hasAudio: false, videoCodec: "h264" });
  });

  it("probes registered L16 bytes without asking ffprobe to guess a headerless stream", async () => {
    let ffprobeCalls = 0;
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => {
        ffprobeCalls += 1;
        throw new Error("raw PCM must not be guessed by ffprobe");
      },
    });

    await expect(
      inspector({
        sourcePath: "/private/generated.bin",
        resource: {
          id: `sha256:${"c".repeat(64)}`,
          kind: "audio",
          digest: { algorithm: "sha256", value: "c".repeat(64) },
          byteLength: 96_000,
          contentType: "audio/L16;codec=pcm;rate=24000;channels=1",
        },
      }),
    ).resolves.toEqual({
      durationMs: 2_000,
      contentType: "audio/L16;codec=pcm;rate=24000;channels=1",
      hasAudio: true,
      audioCodec: "pcm_s16le",
    });
    expect(ffprobeCalls).toBe(0);
  });

  it("rejects decoded streams that do not match the registered Asset kind", async () => {
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => ({
        stdout: JSON.stringify({
          streams: [{ codec_type: "audio", codec_name: "aac" }],
          format: { duration: "1.0" },
        }),
      }),
    });

    await expect(
      inspector({
        sourcePath: "/private/not-a-video.mp4",
        resource: {
          id: `sha256:${"d".repeat(64)}`,
          kind: "video",
          digest: { algorithm: "sha256", value: "d".repeat(64) },
          byteLength: 42,
          contentType: "video/mp4",
        },
      }),
    ).rejects.toThrow(/video stream/i);
  });

  it("rejects a registered MIME that disagrees with the decoded image codec", async () => {
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => ({
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "png",
              width: 64,
              height: 64,
            },
          ],
          format: { format_name: "png_pipe" },
        }),
      }),
    });

    await expect(
      inspector({
        sourcePath: "/private/png-declared-as-jpeg",
        resource: {
          id: `sha256:${"1".repeat(64)}`,
          kind: "image",
          digest: { algorithm: "sha256", value: "1".repeat(64) },
          byteLength: 42,
          contentType: "image/jpeg",
        },
      }),
    ).rejects.toThrow(/image\/png/i);
  });

  it("rejects incomplete decoded facts instead of publishing ambiguous video metadata", async () => {
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => ({
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              avg_frame_rate: "24/1",
            },
          ],
          format: { duration: "1.0" },
        }),
      }),
    });

    await expect(
      inspector({
        sourcePath: "/private/incomplete.mp4",
        resource: {
          id: `sha256:${"e".repeat(64)}`,
          kind: "video",
          digest: { algorithm: "sha256", value: "e".repeat(64) },
          byteLength: 42,
          contentType: "video/mp4",
        },
      }),
    ).rejects.toThrow(/height/i);
  });

  it("validates GLB bytes as a model without invoking ffprobe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-model-probe-"));
    temporaryDirectories.push(directory);
    const json = new TextEncoder().encode('{"asset":{"version":"2.0"}} ');
    const bytes = new Uint8Array(20 + json.byteLength);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("glTF"), 0);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.byteLength, true);
    view.setUint32(12, json.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.set(json, 20);
    const sourcePath = join(directory, "model.glb");
    await writeFile(sourcePath, bytes);
    let ffprobeCalls = 0;
    const inspector = createLocalFfprobeAssetInspector({
      ffprobePath: "/test/bin/ffprobe",
      run: async () => {
        ffprobeCalls += 1;
        throw new Error("glTF validation must not use ffprobe");
      },
    });

    await expect(
      inspector({
        sourcePath,
        resource: {
          id: `sha256:${"f".repeat(64)}`,
          kind: "model",
          digest: { algorithm: "sha256", value: "f".repeat(64) },
          byteLength: bytes.byteLength,
          contentType: "model/gltf-binary",
        },
      }),
    ).resolves.toEqual({ contentType: "model/gltf-binary" });
    expect(ffprobeCalls).toBe(0);
  });

  it("persists verified inspection facts once per Resource across entry identities and restarts", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("metadata source video"),
      contentType: "video/mp4",
    });
    let probes = 0;
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        return {
          width: 1920,
          height: 1080,
          durationMs: 2_500,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: true,
          audioCodec: "aac",
        };
      },
    });

    const firstEntry = await service.inspect({
      source,
      knownFacts: { contentType: "video/mp4", originalName: "first.mp4" },
    });
    const restarted = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        throw new Error("persisted Resource inspection must not rerun");
      },
    });
    const secondEntry = await restarted.inspect({
      source,
      knownFacts: { contentType: "video/mp4", originalName: "second.mp4" },
    });

    expect(probes).toBe(1);
    expect(firstEntry.facts).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 2_500,
      contentType: "video/mp4",
      frameRate: 24,
      videoCodec: "h264",
      hasAudio: true,
      audioCodec: "aac",
    });
    expect(secondEntry.facts).toEqual(firstEntry.facts);
    expect(JSON.stringify(secondEntry)).not.toMatch(
      /first\.mp4|second\.mp4|path|url/i,
    );
  });

  it("removes the obsolete backend representation registry when inspection opens", async () => {
    const { dataDir, resources } = await fixture();
    const { DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          get(...params: unknown[]): Record<string, unknown> | undefined;
        };
        close(): void;
      };
    };
    const legacy = new DatabaseSync(join(dataDir, "local.sqlite"));
    legacy.exec(`
      CREATE TABLE local_asset_representations (
        source_resource_id TEXT NOT NULL,
        recipe TEXT NOT NULL,
        representation_resource_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_resource_id, recipe)
      );
    `);
    legacy.close();

    const source = await resources.install({
      kind: "image",
      bytes: new TextEncoder().encode("inspection-only image"),
      contentType: "image/png",
    });
    const service = createLocalAssetInspectionService({ dataDir });
    await service.inspect({
      source,
      knownFacts: { width: 1, height: 1, contentType: "image/png" },
    });

    const inspected = new DatabaseSync(join(dataDir, "local.sqlite"));
    try {
      expect(
        inspected
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get("local_asset_representations"),
      ).toBeUndefined();
    } finally {
      inspected.close();
    }
  });

  it("reprobes a legacy unversioned inspection once before reusing the current recipe", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("legacy inspection source"),
      contentType: "video/mp4",
    });
    const { DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...params: unknown[]): void;
        };
        close(): void;
      };
    };
    const legacyDatabase = new DatabaseSync(join(dataDir, "local.sqlite"));
    legacyDatabase.exec(`
      CREATE TABLE local_asset_inspections (
        source_resource_id TEXT PRIMARY KEY,
        facts_json TEXT NOT NULL,
        inspected_at INTEGER NOT NULL
      );
    `);
    legacyDatabase
      .prepare(
        `
        INSERT INTO local_asset_inspections (
          source_resource_id, facts_json, inspected_at
        ) VALUES (?, ?, ?)
      `,
      )
      .run(
        source.resource.id,
        JSON.stringify({ width: 320, height: 180 }),
        Date.now(),
      );
    legacyDatabase.close();

    let probes = 0;
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        return {
          width: 1_920,
          height: 1_080,
          durationMs: 1_000,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });
    const first = await service.inspect({ source });

    const restarted = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        throw new Error("the current inspection recipe must be reusable");
      },
    });
    const second = await restarted.inspect({ source });

    expect(probes).toBe(1);
    expect(first.facts).toMatchObject({
      width: 1_920,
      height: 1_080,
      videoCodec: "h264",
    });
    expect(second.facts).toEqual(first.facts);
  });

  it("reprobes a prior versioned recipe after canonical completeness changes", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("v2 inspection source"),
      contentType: "video/mp4",
    });
    const { DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): { run(...params: unknown[]): void };
        close(): void;
      };
    };
    const database = new DatabaseSync(join(dataDir, "local.sqlite"));
    database.exec(`
      CREATE TABLE IF NOT EXISTS local_asset_inspections (
        source_resource_id TEXT NOT NULL,
        recipe TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        inspected_at INTEGER NOT NULL,
        PRIMARY KEY (source_resource_id, recipe)
      );
    `);
    database
      .prepare(
        `INSERT INTO local_asset_inspections
          (source_resource_id, recipe, facts_json, inspected_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        source.resource.id,
        "asset-inspection/v2:canonical-media-facts",
        JSON.stringify({
          width: 320,
          height: 180,
          contentType: "video/mp4",
          videoCodec: "h264",
        }),
        Date.now(),
      );
    database.close();

    let probes = 0;
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        return {
          width: 1_920,
          height: 1_080,
          durationMs: 1_000,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });

    await expect(service.inspect({ source })).resolves.toMatchObject({
      facts: { width: 1_920, durationMs: 1_000, hasAudio: false },
    });
    expect(probes).toBe(1);
  });

  it("does not persist caller metadata as a verified Resource inspection", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "image",
      bytes: new TextEncoder().encode("progressively inspected image"),
      contentType: "image/png",
    });
    const first = createLocalAssetInspectionService({
      dataDir,
    });
    await first.inspect({ source, knownFacts: { contentType: "image/png" } });
    await first.inspect({
      source,
      knownFacts: { contentType: "image/png", width: 800, height: 600 },
    });

    let probes = 0;
    const restarted = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        return { width: 1_920, height: 1_080 };
      },
    });
    await expect(restarted.inspect({ source })).resolves.toMatchObject({
      facts: { contentType: "image/png", width: 1_920, height: 1_080 },
    });
    expect(probes).toBe(1);
  });

  it("rejects incomplete injected video facts before they can become a CAS winner", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("incomplete injected probe"),
      contentType: "video/mp4",
    });
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => ({
        width: 1_920,
        height: 1_080,
        videoCodec: "h264",
      }),
    });

    await expect(service.inspect({ source })).rejects.toThrow(/duration/i);
  });

  it("coalesces concurrent inspection of the same immutable Resource", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("concurrent inspection source"),
      contentType: "video/mp4",
    });
    let probes = 0;
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        await probeGate;
        return {
          width: 1_920,
          height: 1_080,
          durationMs: 2_500,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });

    const first = service.inspect({ source });
    const second = service.inspect({ source });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseProbe!();
    const [firstInspection, secondInspection] = await Promise.all([
      first,
      second,
    ]);

    expect(probes).toBe(1);
    expect(secondInspection.facts).toEqual(firstInspection.facts);
  });

  it("publishes one inspection winner when at-least-once consumers race", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "video",
      bytes: new TextEncoder().encode("multiply inspected source"),
      contentType: "video/mp4",
    });
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const firstConsumer = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        await firstGate;
        return {
          width: 1_920,
          height: 1_080,
          durationMs: 2_500,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });
    const secondConsumer = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        await secondGate;
        return {
          width: 1_280,
          height: 720,
          durationMs: 2_500,
          frameRate: 24,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });

    const first = firstConsumer.inspect({ source });
    const second = secondConsumer.inspect({ source });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFirst!();
    const winner = await first;
    releaseSecond!();

    expect(winner.facts).toMatchObject({ width: 1_920, height: 1_080 });
    await expect(second).rejects.toThrow(
      /conflicts with the inspection CAS winner/i,
    );
    const restarted = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        throw new Error("the CAS winner must be reused");
      },
    });
    await expect(restarted.inspect({ source })).resolves.toEqual(winner);
  });

  it("coalesces a failed inspection without caching ready and permits retry", async () => {
    const { dataDir, resources } = await fixture();
    const source = await resources.install({
      kind: "audio",
      bytes: new TextEncoder().encode("retryable inspection source"),
      contentType: "audio/mpeg",
    });
    let probes = 0;
    let failing = true;
    let releaseFailure: (() => void) | undefined;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const service = createLocalAssetInspectionService({
      dataDir,
      inspectResource: async () => {
        probes += 1;
        if (failing) {
          await failureGate;
          throw new Error("probe failed");
        }
        return {
          durationMs: 4_000,
          hasAudio: true,
          audioCodec: "mp3",
        };
      },
    });

    const first = service.inspect({ source });
    const second = service.inspect({ source });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFailure!();
    const failed = await Promise.allSettled([first, second]);

    expect(failed.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(probes).toBe(1);

    failing = false;
    await expect(service.inspect({ source })).resolves.toMatchObject({
      facts: { durationMs: 4_000, audioCodec: "mp3" },
    });
    expect(probes).toBe(2);
  });
});
