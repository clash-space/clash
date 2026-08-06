import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as projectors from "./projectors";

const reference = (slot: string, index: number, kind: "image" | "video" | "audio", assetId: string) => ({
  slot,
  index,
  asset: {
    assetId,
    uri: `clash-asset://${assetId}`,
    kind,
    mediaType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
  },
});

describe("first-party fal projectors", () => {
  it("declares an executable contract for every exported projector", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
      exports: { functions: Array<{ id: string }> };
      contractTests: string[];
    };
    const coveredExports = manifest.contractTests.map((path) => {
      expect(existsSync(join(root, path))).toBe(true);
      return (JSON.parse(readFileSync(join(root, path), "utf8")) as {
        target: { exportId: string };
      }).target.exportId;
    });
    expect(new Set(coveredExports)).toEqual(
      new Set(manifest.exports.functions.map((entry) => entry.id)),
    );
  });

  it("keeps MiniMax H3 references in H3's reference_* fields", () => {
    const project = (projectors as Record<string, unknown>).projectFalH3 as
      | ((input: unknown) => any)
      | undefined;
    expect(project).toBeDefined();
    if (!project) return;

    expect(project({
      values: { prompt: "Image 1 turns toward Video 1", duration: 8, resolution: "768P", aspect_ratio: "adaptive" },
      references: [
        reference("image", 0, "image", "image-1"),
        reference("video", 0, "video", "video-1"),
        reference("audio", 0, "audio", "audio-1"),
      ],
    })).toEqual({
      endpoint: "minimax/h3/reference-to-video",
      input: {
        prompt: "Image 1 turns toward Video 1",
        duration: 8,
        resolution: "768P",
        aspect_ratio: "adaptive",
        reference_image_urls: ["clash-asset://image-1"],
        reference_video_urls: ["clash-asset://video-1"],
        reference_audio_urls: ["clash-asset://audio-1"],
      },
    });
  });

  it("keeps Seedance references in modality arrays and native prompt order", () => {
    const project = (projectors as Record<string, unknown>).projectFalSeedance2 as
      | ((input: unknown) => any)
      | undefined;
    expect(project).toBeDefined();
    if (!project) return;

    const projected = project({
      values: {
        prompt: "@Image1 then a cut to @Video1",
        duration: "auto",
        resolution: "720p",
        aspect_ratio: "auto",
        generate_audio: true,
        seed: 42,
      },
      references: [
        reference("image", 0, "image", "image-1"),
        reference("video", 0, "video", "video-1"),
      ],
    });
    expect(projected).toMatchObject({
      endpoint: "bytedance/seedance-2.0/reference-to-video",
      input: {
        prompt: "@Image1 then a cut to @Video1",
        image_urls: ["clash-asset://image-1"],
        video_urls: ["clash-asset://video-1"],
      },
    });
    expect(projected.input.reference_image_urls).toBeUndefined();
  });

  it("maps MiniMax Music 3 without inventing a composition plan", () => {
    const project = (projectors as Record<string, unknown>).projectFalMiniMaxMusic3 as
      | ((input: unknown) => any)
      | undefined;
    expect(project).toBeDefined();
    if (!project) return;

    expect(project({
      values: {
        prompt: "dreamy synth pop",
        lyrics: "[Verse]\nNeon rain",
        lyrics_optimizer: true,
        is_instrumental: false,
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3",
      },
      references: [],
    })).toEqual({
      endpoint: "fal-ai/minimax-music/v3",
      input: {
        prompt: "dreamy synth pop",
        lyrics: "[Verse]\nNeon rain",
        lyrics_optimizer: true,
        is_instrumental: false,
        audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
      },
    });
  });
});
