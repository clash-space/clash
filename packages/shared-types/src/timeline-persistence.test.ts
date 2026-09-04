import { describe, expect, it } from "vitest";

import { normalizeProjectTimelinePersistenceState } from "./timeline-persistence.js";

describe("Project Timeline persistence", () => {
  it("strips Host waveform projections while preserving Project Asset identity", () => {
    expect(
      normalizeProjectTimelinePersistenceState({
        tracks: [
          {
            id: "audio-track",
            items: [
              {
                id: "audio-item",
                type: "audio",
                assetId: "asset-audio",
                src: "http://127.0.0.1/media",
                waveformUrl: "http://127.0.0.1/waveform",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      ok: true,
      state: {
        tracks: [
          {
            id: "audio-track",
            items: [
              {
                id: "audio-item",
                type: "audio",
                assetId: "asset-audio",
              },
            ],
          },
        ],
      },
    });
  });
});
