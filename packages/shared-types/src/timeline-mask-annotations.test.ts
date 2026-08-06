import { describe, expect, it } from "vitest";
import {
  createDefaultTimelineItemMask,
  DEFAULT_TIMELINE_ITEM_MASK,
  sampleTimelineKeyframeChannel,
  TIMELINE_MASK_ANIMATION_BINDINGS,
  TIMELINE_MASK_FIELDS,
  TIMELINE_MASK_SCALAR_ANIMATION_BINDINGS,
  TIMELINE_MASK_SHAPE_ANNOTATIONS,
  TIMELINE_MASK_SHAPES,
  TIMELINE_MASK_STATIC_CONTROL_BINDINGS,
  TIMELINE_MASK_VECTOR_ANIMATION_BINDINGS,
} from "./index";

describe("Timeline mask annotation graph", () => {
  it("routes every field to a generated static control or animated control", () => {
    const controlledFields = new Set([
      ...TIMELINE_MASK_STATIC_CONTROL_BINDINGS.map(({ field }) => field),
      ...TIMELINE_MASK_ANIMATION_BINDINGS.map(({ field }) => field),
    ]);

    expect([...controlledFields].sort()).toEqual([...TIMELINE_MASK_FIELDS].sort());
    expect([
      ...TIMELINE_MASK_VECTOR_ANIMATION_BINDINGS,
      ...TIMELINE_MASK_SCALAR_ANIMATION_BINDINGS,
    ].map(({ channel }) => channel).sort()).toEqual(
      TIMELINE_MASK_ANIMATION_BINDINGS.map(({ channel }) => channel).sort(),
    );
  });

  it("derives shape options and render primitives from the same registry", () => {
    expect(TIMELINE_MASK_SHAPES).toEqual(Object.keys(TIMELINE_MASK_SHAPE_ANNOTATIONS));
    expect(Object.values(TIMELINE_MASK_SHAPE_ANNOTATIONS).map(({ renderPrimitive }) => renderPrimitive))
      .toEqual(["rectangle", "ellipse"]);
  });

  it("creates writable defaults without sharing descriptor tuple references", () => {
    const first = createDefaultTimelineItemMask();
    const second = createDefaultTimelineItemMask();

    expect(first).toEqual(DEFAULT_TIMELINE_ITEM_MASK);
    expect(first.position).not.toBe(DEFAULT_TIMELINE_ITEM_MASK.position);
    expect(first.position).not.toBe(second.position);
  });

  it("executes the published hold, linear, and boundary sampling policy", () => {
    const keys = [
      { frame: 2, value: 10, interpolation: "linear" as const },
      { frame: 6, value: 30, interpolation: "hold" as const },
      { frame: 8, value: 50, interpolation: "linear" as const },
    ];
    const interpolate = (left: number, right: number, progress: number) => (
      left + ((right - left) * progress)
    );

    expect(sampleTimelineKeyframeChannel(keys, 0, 0, interpolate)).toBe(10);
    expect(sampleTimelineKeyframeChannel(keys, 4, 0, interpolate)).toBe(20);
    expect(sampleTimelineKeyframeChannel(keys, 7, 0, interpolate)).toBe(30);
    expect(sampleTimelineKeyframeChannel(keys, 10, 0, interpolate)).toBe(50);
    expect(sampleTimelineKeyframeChannel(undefined, 4, 7, interpolate)).toBe(7);
  });
});
