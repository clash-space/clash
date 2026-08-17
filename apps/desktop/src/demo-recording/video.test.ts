import { describe, expect, it } from "vitest";
import {
  buildConcatManifest,
  buildFfmpegArgs,
  evaluateEncodedVideoContract,
  parseEncodedVideoProbe,
  selectPageTarget,
} from "./video.js";

describe("demo recording video plan", () => {
  it("preserves quiet time between CDP screencast frames", () => {
    expect(
      buildConcatManifest(
        [
          { path: "/capture/000001.jpg", monotonicMs: 0 },
          { path: "/capture/000002.jpg", monotonicMs: 100 },
          { path: "/capture/000003.jpg", monotonicMs: 1_600 },
        ],
        2_000,
      ),
    ).toBe(
      [
        "ffconcat version 1.0",
        "file '/capture/000001.jpg'",
        "duration 0.100000",
        "file '/capture/000002.jpg'",
        "duration 1.500000",
        "file '/capture/000003.jpg'",
        "duration 0.400000",
        "file '/capture/000003.jpg'",
        "",
      ].join("\n"),
    );
  });

  it("backfills the short delay before the first received CDP frame", () => {
    expect(
      buildConcatManifest(
        [
          { path: "/capture/000001.jpg", monotonicMs: 120 },
          { path: "/capture/000002.jpg", monotonicMs: 620 },
        ],
        1_000,
      ),
    ).toContain("file '/capture/000001.jpg'\nduration 0.620000");
  });

  it("selects the Clash page instead of DevTools or extension targets", () => {
    expect(
      selectPageTarget(
        [
          {
            id: "devtools",
            type: "page",
            url: "devtools://devtools/bundled/inspector.html",
            webSocketDebuggerUrl: "ws://example/devtools/page/devtools",
          },
          {
            id: "clash",
            type: "page",
            url: "http://127.0.0.1:50880/projects/project-1",
            webSocketDebuggerUrl: "ws://example/devtools/page/clash",
          },
        ],
        "http://127.0.0.1:50880",
      ),
    ).toEqual(expect.objectContaining({ id: "clash" }));
  });

  it("encodes a broadly playable constant-frame-rate MP4", () => {
    expect(buildFfmpegArgs("/capture/frames.ffconcat", "/artifacts/demo.mp4", 2_000)).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-safe",
      "0",
      "-f",
      "concat",
      "-i",
      "/capture/frames.ffconcat",
      "-t",
      "2.000000",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=pc:out_range=tv:out_color_matrix=bt709,fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-movflags",
      "+faststart",
      "/artifacts/demo.mp4",
    ]);
  });

  it("accepts only an exact square-pixel recording viewport", () => {
    expect(
      evaluateEncodedVideoContract({
        viewport: { width: 1_440, height: 900 },
        stream: {
          width: 1_440,
          height: 882,
          sample_aspect_ratio: "49:50",
        },
      }),
    ).toEqual([
      "recording video must be 1440x900 with square pixels; observed 1440x882, SAR 49:50",
    ]);
    expect(
      evaluateEncodedVideoContract({
        viewport: { width: 1_440, height: 900 },
        stream: {
          width: 1_440,
          height: 900,
          sample_aspect_ratio: "1:1",
        },
      }),
    ).toEqual([]);
  });

  it("parses the first ffprobe video stream and rejects incomplete output", () => {
    expect(
      parseEncodedVideoProbe({
        streams: [{ width: 1_440, height: 900, sample_aspect_ratio: "1:1" }],
      }),
    ).toEqual({
      width: 1_440,
      height: 900,
      sample_aspect_ratio: "1:1",
    });
    expect(() => parseEncodedVideoProbe({ streams: [] })).toThrow(
      /video stream/iu,
    );
  });
});
