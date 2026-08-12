import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";

export const GOOGLE_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/google-live-traffic.jsonl", import.meta.url),
);
export const GOOGLE_OMNI_REPLAY_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/google-omni-live-traffic.jsonl", import.meta.url),
);

export function createGoogleOmniProviderCases(): ProviderReplayTestCase[] {
  return [
    {
      id: "google-omni-video",
      type: "video_gen",
      modelId: "gemini-omni-flash",
      prompt:
        "A tiny origami bird takes flight over a white table, with soft paper wing sounds.",
      params: { duration: 3, aspect_ratio: "16:9", resolution: "720p" },
      expect: { kind: "video", mediaType: "video/mp4" },
    },
  ];
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const crcInput = Buffer.concat([name, body]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, name, body, tail]);
}

function solidPng(red: number, green: number, blue: number): Uint8Array {
  const size = 512;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const offset = y * (size * 4 + 1);
    rows[offset] = 0;
    for (let x = 0; x < size; x += 1) {
      rows.set([red, green, blue, 255], offset + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/** One backend acceptance for every Google generation family currently routed through clash.google. */
export async function createGoogleProviderCases(): Promise<
  ProviderReplayTestCase[]
> {
  const startFrame = solidPng(210, 40, 40);
  const endFrame = solidPng(40, 80, 210);
  // Tracked synthetic speech with a companion transcript in artifacts/asr-demo/transcript.json.
  // A pure tone previously made any non-empty model hallucination pass as successful ASR.
  const audio = await readFile(
    new URL("../../../artifacts/asr-demo/short.wav", import.meta.url),
  );

  return [
    {
      id: "google-text",
      type: "text_gen",
      modelId: "gemini-3.5-flash",
      prompt: "Reply with exactly: Clash Google provider replay is ready.",
      params: {
        system_prompt:
          "Return exactly the requested sentence and nothing else.",
      },
      expect: { kind: "text" },
    },
    {
      id: "google-text-pro",
      type: "text_gen",
      modelId: "gemini-3.1-pro",
      prompt: "Reply with exactly: Gemini Pro route is ready.",
      expect: { kind: "text" },
    },
    {
      id: "google-text-flash",
      type: "text_gen",
      modelId: "gemini-3-flash",
      prompt: "Reply with exactly: Gemini Flash route is ready.",
      expect: { kind: "text" },
    },
    {
      id: "google-text-flash-lite",
      type: "text_gen",
      modelId: "gemini-3.1-flash-lite",
      prompt: "Reply with exactly: Gemini Flash Lite route is ready.",
      expect: { kind: "text" },
    },
    {
      id: "google-image",
      type: "image_gen",
      modelId: "nano-banana-2",
      prompt: "A single small red circle centered on a plain white background.",
      params: { aspect_ratio: "1:1", resolution: "1K", count: 1 },
      expect: { kind: "image", mediaType: "image/png" },
    },
    {
      id: "google-image-pro",
      type: "image_gen",
      modelId: "nano-banana-pro",
      prompt:
        "A single small blue triangle centered on a plain white background.",
      params: { aspect_ratio: "1:1" },
      expect: { kind: "image", mediaType: "image/png" },
    },
    {
      id: "google-image-lite",
      type: "image_gen",
      modelId: "nano-banana-2-lite",
      prompt:
        "A single small green square centered on a plain white background.",
      params: { aspect_ratio: "1:1" },
      // Captured live: Flash-Lite currently returns JPEG while both larger image models return PNG.
      expect: { kind: "image", mediaType: "image/jpeg" },
    },
    {
      id: "google-tts-flash",
      type: "audio_gen",
      modelId: "gemini-3.1-flash-tts",
      prompt: "Clash Google speech provider replay is ready.",
      params: { voice_name: "Kore" },
      expect: { kind: "audio" },
    },
    {
      id: "google-tts-pro",
      type: "audio_gen",
      modelId: "gemini-2.5-pro-tts",
      prompt: "Clash Google Pro speech provider replay is ready.",
      params: { voice_name: "Kore" },
      expect: { kind: "audio" },
    },
    {
      id: "google-asr",
      type: "text_gen",
      modelId: "gemini-3.5-flash",
      prompt: "Transcribe the attached audio. Return only the spoken words.",
      refs: [
        {
          id: "google-asr-audio",
          kind: "audio",
          bytes: audio,
          mediaType: "audio/wav",
          originalName: "google-asr.wav",
        },
      ],
      // Captured from both Vertex service-account and Agent Platform Express live runs.
      expect: {
        kind: "text",
        text: "你好clash，测试时间对齐",
        textMatch: "normalized",
      },
    },
    {
      id: "google-veo-quality-text",
      type: "video_gen",
      modelId: "veo-3.1",
      prompt: "A small red paper boat floats on a still pond, fixed wide shot.",
      params: { duration: 4, aspect_ratio: "16:9", generate_audio: false },
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "google-veo-fast-reference",
      type: "video_gen",
      modelId: "veo-3.1-fast",
      prompt:
        "The reference mark rises gently above a white table, fixed camera.",
      // Captured live: reference_to_video currently accepts only eight-second outputs.
      params: { duration: 8, aspect_ratio: "16:9", generate_audio: false },
      refs: [
        {
          id: "google-veo-reference",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "google-veo-reference.png",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "google-veo-quality-startend",
      type: "video_gen",
      modelId: "veo-3.1-startend",
      prompt: "A smooth restrained transition from red to blue.",
      params: { duration: 4, aspect_ratio: "16:9", generate_audio: false },
      refs: [
        {
          id: "google-veo-quality-start-frame",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "google-veo-quality-start.png",
        },
        {
          id: "google-veo-quality-end-frame",
          kind: "image",
          bytes: endFrame,
          mediaType: "image/png",
          originalName: "google-veo-quality-end.png",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
    {
      id: "google-veo-fast-startend",
      type: "video_gen",
      modelId: "veo-3.1-fast-startend",
      prompt:
        "A smooth restrained transition from the first frame to the last frame.",
      params: { duration: 4, aspect_ratio: "16:9", generate_audio: false },
      refs: [
        {
          id: "google-veo-start-frame",
          kind: "image",
          bytes: startFrame,
          mediaType: "image/png",
          originalName: "google-veo-start.png",
        },
        {
          id: "google-veo-end-frame",
          kind: "image",
          bytes: endFrame,
          mediaType: "image/png",
          originalName: "google-veo-end.png",
        },
      ],
      expect: { kind: "video", mediaType: "video/mp4" },
    },
  ];
}
