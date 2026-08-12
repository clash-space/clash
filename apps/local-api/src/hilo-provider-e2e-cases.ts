import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";
import { activateHostExecutablePluginPackage } from "./runtime/plugin-package.js";

export const HILO_H3_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/hilo-live-traffic.jsonl", import.meta.url),
);
export const HILO_SEEDANCE_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/hilo-seedance-live-traffic.jsonl", import.meta.url),
);

interface HiloDevelopmentManifest {
  id: string;
  runtime: { entrypoint: string };
  contributes?: {
    cards?: Array<{ path?: string }>;
    providers?: Array<{ path?: string }>;
    modelBindings?: Array<{ path?: string }>;
  };
  contractTests?: string[];
}

/** Activate the source-backed third-party plugin inside one isolated provider harness. */
export async function prepareHiloProviderTestPlugin(options: {
  actionsRoot: string;
  dataDir: string;
}): Promise<void> {
  const pluginRoot = fileURLToPath(
    new URL("../../../plugins/hrhrng-hub/", import.meta.url),
  );
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, "manifest.json"), "utf8"),
  ) as HiloDevelopmentManifest;
  if (manifest.id !== "hrhrng.hub" || !manifest.runtime?.entrypoint) {
    throw new Error("Hilo provider test package has an invalid manifest.");
  }

  const sourceEntrypoint = join(pluginRoot, "src", "stdio.ts");
  const tsconfigPath = fileURLToPath(
    new URL("../tsconfig.dev.json", import.meta.url),
  );
  const tsxApiUrl = pathToFileURL(
    createRequire(import.meta.url).resolve("tsx/esm/api"),
  ).href;
  const launcher = [
    `import { register } from ${JSON.stringify(tsxApiUrl)};`,
    `register({ tsconfig: ${JSON.stringify(tsconfigPath)} });`,
    `process.argv[1] = ${JSON.stringify(sourceEntrypoint)};`,
    `await import(${JSON.stringify(pathToFileURL(sourceEntrypoint).href)});`,
    "",
  ].join("\n");
  const files: Record<string, string> = {
    [manifest.runtime.entrypoint]: Buffer.from(launcher).toString("base64"),
  };
  const documents = [
    ...(manifest.contributes?.cards ?? []).map(({ path }) => path),
    ...(manifest.contributes?.providers ?? []).map(({ path }) => path),
    ...(manifest.contributes?.modelBindings ?? []).map(({ path }) => path),
    ...(manifest.contractTests ?? []),
  ];
  for (const relativePath of documents) {
    if (!relativePath) continue;
    files[relativePath] = (
      await readFile(join(pluginRoot, relativePath))
    ).toString("base64");
  }

  await activateHostExecutablePluginPackage(
    { id: manifest.id, manifest, files },
    options.actionsRoot,
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const chunk = Buffer.alloc(12 + body.byteLength);
  chunk.writeUInt32BE(body.byteLength, 0);
  name.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, body])), 8 + body.byteLength);
  return chunk;
}

/** A deterministic real PNG accepted by both H3 and Seedance reference upload paths. */
function solidPng(red: number, green: number, blue: number): Uint8Array {
  const width = 256;
  const height = 256;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      scanlines[pixel] = red;
      scanlines[pixel + 1] = green;
      scanlines[pixel + 2] = blue;
      scanlines[pixel + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/**
 * The two third-party routes whose multimodal uploads need a real backend acceptance.
 * Both use the same valid MP3 reference so the cassette proves Hilo receives `.mp3`, not `.mpeg`.
 */
export async function createHiloProviderCases(): Promise<ProviderReplayTestCase[]> {
  const referenceMp3 = await readFile(
    new URL("./fixtures/minimax-h3-reference.mp3", import.meta.url),
  );
  const h3Image = solidPng(194, 40, 53);
  const seedanceImage = solidPng(38, 86, 190);

  return [
    {
      id: "hilo-minimax-h3-image-mp3",
      type: "video_gen",
      modelId: "minimax-h3",
      prompt:
        "Keep @[Crimson Subject](node:hilo-h3-image) centered and synchronize its motion to @[Reference Beat](node:hilo-h3-audio).",
      params: {
        duration: 4,
        resolution: "768P",
        aspect_ratio: "16:9",
      },
      refs: [
        {
          id: "hilo-h3-image",
          kind: "image",
          bytes: h3Image,
          mediaType: "image/png",
          originalName: "hilo-h3-reference.png",
        },
        {
          id: "hilo-h3-audio",
          kind: "audio",
          bytes: referenceMp3,
          mediaType: "audio/mpeg",
          originalName: "hilo-h3-reference.mp3",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "hilo-seedance-2-audio-reference",
      type: "video_gen",
      modelId: "seedance-2-ref",
      prompt:
        "Animate @[Blue Subject](node:hilo-seedance-image) in time with @[Reference Beat](node:hilo-seedance-audio), then hold the final pose.",
      params: {
        duration: 4,
        resolution: "480p",
        aspect_ratio: "16:9",
        generate_audio: false,
      },
      refs: [
        {
          id: "hilo-seedance-image",
          kind: "image",
          bytes: seedanceImage,
          mediaType: "image/png",
          originalName: "hilo-seedance-reference.png",
        },
        {
          id: "hilo-seedance-audio",
          kind: "audio",
          bytes: referenceMp3,
          mediaType: "audio/mpeg",
          originalName: "hilo-seedance-reference.mp3",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
  ];
}

export function selectHiloProviderCases(
  cases: readonly ProviderReplayTestCase[],
  targets: string | undefined,
): ProviderReplayTestCase[] {
  if (!targets?.trim()) return [...cases];
  const requested = [
    ...new Set(targets.split(",").map((id) => id.trim()).filter(Boolean)),
  ];
  const known = new Set(cases.map(({ id }) => id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown CLASH_PROVIDER_E2E_TARGETS: ${unknown.join(", ")}. `
        + `Expected one or more of: ${[...known].join(", ")}`,
    );
  }
  const selected = new Set(requested);
  return cases.filter(({ id }) => selected.has(id));
}
