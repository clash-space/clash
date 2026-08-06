import { describe, expect, it } from "vitest";
import {
  TIMELINE_MASK_ANIMATION_BINDINGS,
  type TimelineItemKeyframes,
} from "@clash/shared-types";
import {
  findAdjacentTimelineKeyframes,
  removeTimelineKeyframe,
  removeTimelineMaskKeyframes,
  rippleDeleteTimelineKeyframes,
  sampleTimelineKeyframes,
  sliceTimelineKeyframes,
  upsertTimelineKeyframe,
  type TimelineKeyframeSample,
} from "./timelineKeyframes";

const baseSample: TimelineKeyframeSample = {
  position: [10, 20],
  scale: [1, 1],
  rotation: 5,
  opacity: 0.8,
};

describe("Timeline keyframe sampling", () => {
  it("linearly samples each active channel at an item-local frame", () => {
    const keyframes: TimelineItemKeyframes = {
      position: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 20, value: [100, 50], interpolation: "linear" },
      ],
      scale: [
        { frame: 0, value: [1, 1], interpolation: "linear" },
        { frame: 20, value: [2, 0.5], interpolation: "linear" },
      ],
      rotation: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 20, value: 90, interpolation: "linear" },
      ],
      opacity: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 20, value: 1, interpolation: "linear" },
      ],
    };

    expect(sampleTimelineKeyframes(keyframes, 10, baseSample)).toEqual({
      position: [50, 25],
      scale: [1.5, 0.75],
      rotation: 45,
      opacity: 0.5,
    });
  });

  it("samples mask channels without mixing item-local and composition frames", async () => {
    const module = await import("./timelineKeyframes");
    const sampleMask = (module as unknown as {
      sampleTimelineMaskKeyframes?: (
        keyframes: TimelineItemKeyframes,
        frame: number,
        fallback: {
          position: readonly [number, number];
          size: readonly [number, number];
          rotation: number;
          feather: number;
        },
      ) => unknown;
    }).sampleTimelineMaskKeyframes;
    expect(sampleMask).toBeTypeOf("function");
    expect(sampleMask?.({
      maskPosition: [
        { frame: 0, value: [20, 50], interpolation: "linear" },
        { frame: 20, value: [80, 50], interpolation: "linear" },
      ],
      maskSize: [
        { frame: 0, value: [40, 40], interpolation: "linear" },
        { frame: 20, value: [80, 60], interpolation: "linear" },
      ],
      maskRotation: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 20, value: 90, interpolation: "linear" },
      ],
      maskFeather: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 20, value: 40, interpolation: "linear" },
      ],
    }, 10, {
      position: [50, 50],
      size: [70, 70],
      rotation: 0,
      feather: 0,
    })).toEqual({
      position: [50, 50],
      size: [60, 50],
      rotation: 45,
      feather: 20,
    });
    expect(Object.keys(sampleMask?.(undefined as any, 10, {
      position: [50, 50],
      size: [70, 70],
      rotation: 0,
      feather: 0,
    }) as object).sort()).toEqual(
      TIMELINE_MASK_ANIMATION_BINDINGS.map(({ field }) => field).sort(),
    );
  });
});

describe("Timeline keyframe editing", () => {
  it("upserts by channel and frame while keeping keys sorted", () => {
    const original: TimelineItemKeyframes = {
      rotation: [
        { frame: 20, value: 90, interpolation: "linear" },
        { frame: 0, value: 0, interpolation: "linear" },
      ],
    };

    const inserted = upsertTimelineKeyframe(
      original,
      "rotation",
      { frame: 10, value: 45, interpolation: "hold" },
    );
    const replaced = upsertTimelineKeyframe(
      inserted,
      "rotation",
      { frame: 10, value: 50, interpolation: "linear" },
    );

    expect(replaced.rotation).toEqual([
      { frame: 0, value: 0, interpolation: "linear" },
      { frame: 10, value: 50, interpolation: "linear" },
      { frame: 20, value: 90, interpolation: "linear" },
    ]);
    expect(original.rotation).toEqual([
      { frame: 20, value: 90, interpolation: "linear" },
      { frame: 0, value: 0, interpolation: "linear" },
    ]);
  });

  it("removes an empty channel and returns undefined when no animation remains", () => {
    expect(removeTimelineKeyframe({
      opacity: [{ frame: 5, value: 0.5, interpolation: "linear" }],
    }, "opacity", 5)).toBeUndefined();
  });

  it("removes only mask channels when a mask is deleted", () => {
    expect(removeTimelineMaskKeyframes({
      position: [{ frame: 0, value: [0, 0], interpolation: "linear" }],
      maskPosition: [{ frame: 0, value: [50, 50], interpolation: "linear" }],
      maskFeather: [{ frame: 0, value: 20, interpolation: "linear" }],
    })).toEqual({
      position: [{ frame: 0, value: [0, 0], interpolation: "linear" }],
    });
  });

  it("finds previous, current, and next keyframe frames", () => {
    const keyframes: TimelineItemKeyframes = {
      position: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 10, value: [10, 10], interpolation: "linear" },
        { frame: 20, value: [20, 20], interpolation: "linear" },
      ],
    };

    expect(findAdjacentTimelineKeyframes(keyframes, "position", 10)).toEqual({
      previousFrame: 0,
      hasCurrent: true,
      nextFrame: 20,
    });
    expect(findAdjacentTimelineKeyframes(keyframes, "position", 14)).toEqual({
      previousFrame: 10,
      hasCurrent: false,
      nextFrame: 20,
    });
  });
});

describe("Timeline keyframe slicing", () => {
  it("samples new boundaries and rebases item-local frames without changing linear motion", () => {
    const original: TimelineItemKeyframes = {
      position: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 20, value: [100, 40], interpolation: "linear" },
      ],
      opacity: [
        { frame: 0, value: 1, interpolation: "hold" },
        { frame: 20, value: 0, interpolation: "linear" },
      ],
    };

    const sliced = sliceTimelineKeyframes(original, 5, 11);

    expect(sliced).toEqual({
      position: [
        { frame: 0, value: [25, 10], interpolation: "linear" },
        { frame: 10, value: [75, 30], interpolation: "linear" },
      ],
      opacity: [
        { frame: 0, value: 1, interpolation: "hold" },
        { frame: 10, value: 1, interpolation: "linear" },
      ],
    });
    expect(sampleTimelineKeyframes(sliced, 5, baseSample).position).toEqual([50, 20]);
  });

  it("closes a deleted middle range while sampling both new boundaries", () => {
    const keyframes: TimelineItemKeyframes = {
      opacity: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 19, value: 1, interpolation: "linear" },
      ],
    };

    expect(rippleDeleteTimelineKeyframes(keyframes, 5, 15, 20)).toEqual({
      opacity: [
        { frame: 0, value: 0, interpolation: "linear" },
        { frame: 4, value: 4 / 19, interpolation: "linear" },
        { frame: 5, value: 15 / 19, interpolation: "linear" },
        { frame: 9, value: 1, interpolation: "linear" },
      ],
    });
  });

  it("slices vector and scalar mask channels with the same item-local rules", () => {
    const keyframes = {
      maskPosition: [
        { frame: 0, value: [20, 50], interpolation: "linear" as const },
        { frame: 20, value: [80, 50], interpolation: "linear" as const },
      ],
      maskFeather: [
        { frame: 0, value: 0, interpolation: "linear" as const },
        { frame: 20, value: 40, interpolation: "linear" as const },
      ],
    } as TimelineItemKeyframes;

    expect(sliceTimelineKeyframes(keyframes, 5, 11)).toEqual({
      maskPosition: [
        { frame: 0, value: [35, 50], interpolation: "linear" },
        { frame: 10, value: [65, 50], interpolation: "linear" },
      ],
      maskFeather: [
        { frame: 0, value: 10, interpolation: "linear" },
        { frame: 10, value: 30, interpolation: "linear" },
      ],
    });
  });

  it("re-samples mask channels after a ripple deletion", () => {
    const keyframes = {
      maskPosition: [
        { frame: 0, value: [20, 50], interpolation: "linear" as const },
        { frame: 20, value: [80, 50], interpolation: "linear" as const },
      ],
      maskFeather: [
        { frame: 0, value: 0, interpolation: "linear" as const },
        { frame: 20, value: 40, interpolation: "linear" as const },
      ],
    } as TimelineItemKeyframes;

    expect(rippleDeleteTimelineKeyframes(keyframes, 0, 5, 21)).toEqual({
      maskPosition: [
        { frame: 0, value: [35, 50], interpolation: "linear" },
        { frame: 15, value: [80, 50], interpolation: "linear" },
      ],
      maskFeather: [
        { frame: 0, value: 10, interpolation: "linear" },
        { frame: 15, value: 40, interpolation: "linear" },
      ],
    });
  });
});
