import { describe, expect, it } from "vitest";
import { getRenderMetadataFromHeaders } from "./render-metadata";

describe("getRenderMetadataFromHeaders", () => {
  it("prefers explicit render headers", () => {
    const headers = new Headers({
      "X-Render-Width": "1280",
      "X-Render-Height": "720",
      "X-Render-Duration-Ms": "4500",
    });

    expect(
      getRenderMetadataFromHeaders(headers, {
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 30,
        durationInFrames: 300,
      }),
    ).toEqual({
      width: 1280,
      height: 720,
      durationMs: 4500,
    });
  });

  it("falls back to timeline dsl when headers are missing", () => {
    expect(
      getRenderMetadataFromHeaders(new Headers(), {
        compositionWidth: 1920,
        compositionHeight: 1080,
        fps: 24,
        durationInFrames: 96,
      }),
    ).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 4000,
    });
  });

  it("ignores invalid header values and keeps valid fallbacks", () => {
    const headers = new Headers({
      "X-Render-Width": "oops",
      "X-Render-Duration-Ms": "5000",
    });

    expect(
      getRenderMetadataFromHeaders(headers, {
        compositionWidth: 1440,
        compositionHeight: 810,
        fps: 25,
        durationInFrames: 100,
      }),
    ).toEqual({
      width: 1440,
      height: 810,
      durationMs: 5000,
    });
  });
});
