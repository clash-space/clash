import { afterEach, describe, expect, it, vi } from "vitest";

describe("Timeline YAML registry synchronization", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("round-trips future root and track fields added only to the annotation registry", async () => {
    vi.resetModules();
    const annotationsModule = await import("./timeline-field-annotations");
    const annotations = annotationsModule.TIMELINE_DSL_FIELD_ANNOTATIONS as unknown as {
      root: Record<string, unknown>;
      track: Record<string, unknown>;
    };

    annotations.root.futureRootMemo = {
      ...annotations.root.primaryTrackId as object,
      description: "Synthetic future root field used to prove codec synchronization.",
    };
    annotations.track.futureTrackFlag = {
      ...annotations.track.hidden as object,
      description: "Synthetic future track field used to prove codec synchronization.",
    };

    try {
      const { timelineDslFromYaml, timelineDslToYaml } = await import("./timeline-yaml");
      const yaml = timelineDslToYaml({
        futureRootMemo: "memo-v1",
        tracks: [{
          id: "visual",
          items: [],
          futureTrackFlag: false,
        }],
      });

      expect(yaml).toContain("futureRootMemo: memo-v1");
      expect(yaml).toContain("futureTrackFlag: false");

      const parsed = timelineDslFromYaml(yaml);
      expect(parsed).toMatchObject({
        ok: true,
        dsl: {
          futureRootMemo: "memo-v1",
          tracks: [{ futureTrackFlag: false }],
        },
      });
    } finally {
      delete annotations.root.futureRootMemo;
      delete annotations.track.futureTrackFlag;
    }
  });

  it("runs the canonical annotated contract before returning a resolved document", async () => {
    const { timelineDslFromYaml } = await import("./timeline-yaml");
    const parsed = timelineDslFromYaml(`
tracks:
  - id: audio
    category: audio
    items:
      - id: bed
        type: audio
        src: /bed.wav
        from: 0
        durationInFrames: 30
        properties:
          x: 0
          y: 0
          width: 1
          height: 1
`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("properties is only valid on");
  });
});
