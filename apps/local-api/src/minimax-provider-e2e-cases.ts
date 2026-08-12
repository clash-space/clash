import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";

export const MINIMAX_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/minimax-live-traffic.jsonl", import.meta.url),
);
export const MINIMAX_MIXED_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/minimax-mixed-live-traffic.jsonl", import.meta.url),
);
export const MINIMAX_STARTEND_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/minimax-startend-live-traffic.jsonl", import.meta.url),
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

/** A dependency-free, deterministic 256x256 RGBA PNG for real H3 frame input. */
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
 * One inexpensive acceptance for every MiniMax family exposed by Clash.
 * The two generated 256px PNGs satisfy H3's real first/last-frame minimums;
 * placeholder bytes such as `AA==` only exercise our serializer and are
 * rejected by the vendor.
 */
export async function createMiniMaxProviderCases(): Promise<ProviderReplayTestCase[]> {
  const startFrame = solidPng(196, 44, 52);
  const endFrame = solidPng(42, 94, 184);
  const referenceMp3 = await readFile(
    new URL("./fixtures/minimax-h3-reference.mp3", import.meta.url),
  );

  return [
    {
      id: "minimax-m3",
      type: "text_gen",
      modelId: "minimax-m3",
      prompt: "Reply with exactly: Clash MiniMax provider replay is ready.",
      params: {
        system_prompt: "Return exactly the requested sentence and nothing else.",
      },
      expect: { kind: "text" },
    },
    {
      id: "minimax-tts",
      type: "audio_gen",
      modelId: "minimax-tts",
      prompt: "Clash MiniMax provider replay is ready.",
      params: {
        voice_id: "female-warm",
      },
      expect: { kind: "audio", mediaType: "audio/wav" },
    },
    {
      id: "minimax-music-3",
      type: "audio_gen",
      modelId: "minimax-music-3",
      prompt: "A short, gentle piano logo sting with a clean ending.",
      params: {
        is_instrumental: true,
        sample_rate: 16_000,
        bitrate: 32_000,
        format: "mp3",
      },
      expect: { kind: "audio", mediaType: "audio/mpeg" },
    },
    {
      id: "minimax-h3",
      type: "video_gen",
      modelId: "minimax-h3",
      prompt: "A red sphere rolls slowly across a matte gray floor, locked camera.",
      params: {
        duration: 4,
        resolution: "768P",
        aspect_ratio: "16:9",
      },
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "minimax-h3-mixed-references",
      type: "video_gen",
      modelId: "minimax-h3",
      prompt:
        "Keep @[Crimson Subject](node:minimax-h3-mixed-red) centered while the scene opens, then move into @[Blue Environment](node:minimax-h3-mixed-blue) as the camera pushes forward.",
      params: {
        duration: 4,
        resolution: "768P",
        aspect_ratio: "16:9",
      },
      refs: [
        {
          id: "minimax-h3-mixed-red",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "minimax-h3-mixed-red.png",
        },
        {
          id: "minimax-h3-mixed-blue",
          kind: "image",
          bytes: endFrame,
          mediaType: "image/png",
          originalName: "minimax-h3-mixed-blue.png",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "minimax-h3-mixed-image-audio",
      type: "video_gen",
      modelId: "minimax-h3",
      prompt:
        "Keep @[Crimson Subject](node:minimax-h3-audio-image) centered, then synchronize the motion to @[Reference Beat](node:minimax-h3-audio-mp3) before holding the final pose.",
      params: {
        duration: 4,
        resolution: "768P",
        aspect_ratio: "16:9",
      },
      refs: [
        {
          id: "minimax-h3-audio-image",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "minimax-h3-audio-image.png",
        },
        {
          id: "minimax-h3-audio-mp3",
          kind: "audio",
          bytes: referenceMp3,
          mediaType: "audio/mpeg",
          originalName: "minimax-h3-audio-reference.mp3",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "minimax-h3-startend",
      type: "video_gen",
      modelId: "minimax-h3-startend",
      prompt: "A smooth, restrained transition from the first frame to the last frame.",
      params: {
        duration: 4,
        resolution: "768P",
      },
      refs: [
        {
          id: "minimax-h3-start-frame",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "minimax-h3-start.png",
        },
        {
          id: "minimax-h3-end-frame",
          kind: "image",
          bytes: endFrame,
          mediaType: "image/png",
          originalName: "minimax-h3-end.png",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
  ];
}

/** Select costly live cases without changing the canonical full replay order. */
export function selectMiniMaxProviderCases(
  cases: readonly ProviderReplayTestCase[],
  targets: string | undefined,
): ProviderReplayTestCase[] {
  if (!targets?.trim()) return [...cases];
  const requested = [...new Set(targets.split(",").map((id) => id.trim()).filter(Boolean))];
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
