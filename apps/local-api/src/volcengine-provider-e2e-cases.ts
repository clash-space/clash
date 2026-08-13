import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";

export const VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/volcengine-seed-audio-live-traffic.jsonl", import.meta.url),
);
export const VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/volcengine-modelark-live-traffic.jsonl", import.meta.url),
);

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

function solidPng(red: number, green: number, blue: number): Uint8Array {
  const width = 300;
  const height = 300;
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

async function referenceVideo(): Promise<Uint8Array> {
  const encoded = await readFile(
    new URL("./fixtures/seedance-reference.mp4.base64", import.meta.url),
    "utf8",
  );
  return Buffer.from(encoded.trim(), "base64");
}

/**
 * Project-backend acceptances for every distinct ModelArk Seedance surface:
 * text, all-purpose references, first/last frames, editing, and extension.
 */
export async function createVolcengineModelArkCases(): Promise<ProviderReplayTestCase[]> {
  const firstFrame = solidPng(42, 101, 190);
  const lastFrame = solidPng(205, 73, 58);
  const referenceMp3 = await readFile(
    new URL("./fixtures/minimax-h3-reference.mp3", import.meta.url),
  );
  const video = await referenceVideo();

  const imageRef = (id: string, bytes = firstFrame) => ({
    id,
    kind: "image" as const,
    bytes,
    mediaType: "image/png",
    originalName: `${id}.png`,
  });
  const audioRef = (id: string) => ({
    id,
    kind: "audio" as const,
    bytes: referenceMp3,
    mediaType: "audio/mpeg",
    originalName: `${id}.mp3`,
  });
  const videoRef = (id: string) => ({
    id,
    kind: "video" as const,
    bytes: video,
    mediaType: "video/mp4",
    originalName: `${id}.mp4`,
  });

  return [
    {
      id: "volcengine-seedance-2-text",
      type: "video_gen",
      modelId: "seedance-2-ref",
      prompt: "A blue glass sphere rotates slowly on a matte white table, locked camera.",
      params: {
        duration: "auto",
        aspect_ratio: "auto",
        resolution: "480p",
        generate_audio: false,
      },
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2-reference",
      type: "video_gen",
      modelId: "seedance-2-ref",
      prompt:
        "Animate @[Blue Subject](node:volcengine-seedance-2-reference-image) in time with @[Reference Beat](node:volcengine-seedance-2-reference-audio).",
      params: {
        duration: 4,
        aspect_ratio: "auto",
        resolution: "480p",
        generate_audio: false,
      },
      refs: [
        imageRef("volcengine-seedance-2-reference-image"),
        audioRef("volcengine-seedance-2-reference-audio"),
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2-startend",
      type: "video_gen",
      modelId: "seedance-2-startend",
      prompt: "Transition smoothly from the blue frame to the red frame.",
      params: { duration: 4, resolution: "480p", generate_audio: false },
      refs: [
        imageRef("volcengine-seedance-2-first-frame"),
        imageRef("volcengine-seedance-2-last-frame", lastFrame),
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2-extend",
      type: "video_gen",
      modelId: "seedance-2-extend",
      prompt:
        "Continue @[Source Clip](node:volcengine-seedance-2-extend-video) with the same camera and motion.",
      params: { duration: 4, resolution: "480p", generate_audio: false },
      refs: [videoRef("volcengine-seedance-2-extend-video")],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2.5-text",
      type: "video_gen",
      modelId: "seedance-2.5-ref",
      prompt: "A small red paper kite rises into a clear blue sky, gentle camera tilt.",
      params: {
        duration: 4,
        aspect_ratio: "16:9",
        resolution: "480p",
        generate_audio: false,
      },
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2.5-reference",
      type: "video_gen",
      modelId: "seedance-2.5-ref",
      prompt:
        "Animate @[Blue Subject](node:volcengine-seedance-2.5-reference-image) in time with @[Reference Beat](node:volcengine-seedance-2.5-reference-audio).",
      params: {
        duration: 4,
        aspect_ratio: "auto",
        resolution: "480p",
        generate_audio: false,
      },
      refs: [
        imageRef("volcengine-seedance-2.5-reference-image"),
        audioRef("volcengine-seedance-2.5-reference-audio"),
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2.5-edit",
      type: "video_gen",
      modelId: "seedance-2.5-ref",
      prompt:
        "Edit @[Source Clip](node:volcengine-seedance-2.5-edit-video) so the blue field gradually becomes red.",
      params: {
        duration: "auto",
        aspect_ratio: "auto",
        resolution: "480p",
        generate_audio: false,
        edit_mode: true,
      },
      refs: [videoRef("volcengine-seedance-2.5-edit-video")],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2.5-startend",
      type: "video_gen",
      modelId: "seedance-2.5-startend",
      prompt: "Transition smoothly from the blue frame to the red frame.",
      params: { duration: 4, resolution: "480p", generate_audio: false },
      refs: [
        imageRef("volcengine-seedance-2.5-first-frame"),
        imageRef("volcengine-seedance-2.5-last-frame", lastFrame),
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "volcengine-seedance-2.5-extend",
      type: "video_gen",
      modelId: "seedance-2.5-extend",
      prompt:
        "Continue @[Source Clip](node:volcengine-seedance-2.5-extend-video) with the same camera and motion.",
      params: { duration: 4, resolution: "480p", generate_audio: false },
      refs: [videoRef("volcengine-seedance-2.5-extend-video")],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
  ];
}

/** One Project-backend acceptance for each input mode published by Seed Audio 1.0. */
export async function createVolcengineSeedAudioCases(): Promise<ProviderReplayTestCase[]> {
  const referenceMp3 = await readFile(
    new URL("./fixtures/minimax-h3-reference.mp3", import.meta.url),
  );
  const referenceImage = solidPng(47, 101, 180);

  return [
    {
      id: "volcengine-seed-audio-text",
      type: "audio_gen",
      modelId: "seed-audio-1",
      prompt: "生成一声简短、清脆的提示音，时长约两秒。",
      params: { format: "mp3", sample_rate: 24_000 },
      expect: { kind: "audio", mediaType: "audio/mpeg" },
    },
    {
      id: "volcengine-seed-audio-image",
      type: "audio_gen",
      modelId: "seed-audio-1",
      prompt: "根据蓝色画面生成一段安静、通透的环境音，时长约两秒。",
      params: { format: "mp3", sample_rate: 24_000 },
      refs: [
        {
          id: "volcengine-seed-audio-image-ref",
          kind: "image",
          bytes: referenceImage,
          mediaType: "image/png",
          originalName: "seed-audio-blue-reference.png",
        },
      ],
      expect: { kind: "audio", mediaType: "audio/mpeg" },
    },
    {
      id: "volcengine-seed-audio-audio",
      type: "audio_gen",
      modelId: "seed-audio-1",
      prompt: "参考 @[节奏样本](node:volcengine-seed-audio-audio-ref) 的节奏，生成一段两秒的轻柔提示音。",
      params: { format: "mp3", sample_rate: 24_000 },
      refs: [
        {
          id: "volcengine-seed-audio-audio-ref",
          kind: "audio",
          bytes: referenceMp3,
          mediaType: "audio/mpeg",
          originalName: "seed-audio-reference.mp3",
        },
      ],
      expect: { kind: "audio", mediaType: "audio/mpeg" },
    },
  ];
}

export function selectVolcengineProviderCases(
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

export const selectVolcengineSeedAudioCases = selectVolcengineProviderCases;
