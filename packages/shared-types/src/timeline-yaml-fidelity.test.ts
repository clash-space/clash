import { describe, expect, it } from "vitest";
import { timelineDslFromYaml, timelineDslToYaml } from "./index.js";

describe("Timeline YAML full-state fidelity", () => {
  it("round-trips persisted root and track fields without silently dropping state", () => {
    const state = {
      compositionWidth: 1080,
      compositionHeight: 1920,
      fps: 30,
      durationInFrames: 90,
      primaryTrackId: null,
      assetTranscripts: {
        speech: {
          schemaVersion: 1 as const,
          kind: "clash.editor.asset-transcript" as const,
          assetId: "speech",
          text: "hello",
          durationMs: 1000,
          words: [{ id: "w1", text: "hello", startMs: 0, endMs: 500 }],
        },
      },
      "x-project-extension": { keep: true },
      tracks: [
        {
          id: "voice",
          name: "Voice",
          role: "narration",
          category: "audio" as const,
          hidden: false,
          locked: false,
          "x-track-extension": { keep: true },
          items: [],
        },
      ],
    };

    const parsed = timelineDslFromYaml(timelineDslToYaml(state as any));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dsl).toEqual(state);
  });
});
