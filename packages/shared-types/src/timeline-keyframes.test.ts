import { describe, expect, it } from "vitest";
import { validateTimelineItemKeyframes } from "./timeline-keyframes";

describe("Timeline item keyframe contract", () => {
  it("requires the keyframes field to be an object", () => {
    expect(validateTimelineItemKeyframes("not-an-object", 60)).toBe(
      "keyframes must be an object",
    );
  });

  it("rejects unknown channels", () => {
    expect(validateTimelineItemKeyframes({ blur: [] }, 60)).toBe(
      "keyframes.blur is unsupported",
    );
  });

  it("requires every channel to be an array", () => {
    expect(validateTimelineItemKeyframes({ rotation: {} }, 60)).toBe(
      "keyframes.rotation must be an array",
    );
  });

  it("requires integer frames inside the clip duration", () => {
    expect(validateTimelineItemKeyframes({
      opacity: [{ frame: 60, value: 1, interpolation: "linear" }],
    }, 60)).toBe("keyframes.opacity frame must be an integer between 0 and 59");
  });

  it("only accepts hold and linear interpolation", () => {
    expect(validateTimelineItemKeyframes({
      rotation: [{ frame: 0, value: 0, interpolation: "bezier" }],
    }, 60)).toBe("keyframes.rotation interpolation must be hold or linear");
  });

  it("requires finite position vectors", () => {
    expect(validateTimelineItemKeyframes({
      position: [{ frame: 0, value: [0, Number.POSITIVE_INFINITY], interpolation: "linear" }],
    }, 60)).toBe("keyframes.position value must be a finite [x, y] tuple");
  });

  it("requires non-negative finite scale vectors", () => {
    expect(validateTimelineItemKeyframes({
      scale: [{ frame: 0, value: [1, -0.1], interpolation: "linear" }],
    }, 60)).toBe("keyframes.scale value must be a non-negative finite [x, y] tuple");
  });

  it("requires finite rotation values", () => {
    expect(validateTimelineItemKeyframes({
      rotation: [{ frame: 0, value: Number.NaN, interpolation: "linear" }],
    }, 60)).toBe("keyframes.rotation value must be finite");
  });

  it("constrains opacity values to zero through one", () => {
    expect(validateTimelineItemKeyframes({
      opacity: [{ frame: 0, value: 1.1, interpolation: "linear" }],
    }, 60)).toBe("keyframes.opacity value must be between 0 and 1");
  });

  it("accepts valid sparse channels", () => {
    expect(validateTimelineItemKeyframes({
      position: [
        { frame: 0, value: [0, 0], interpolation: "linear" },
        { frame: 30, value: [120, 60], interpolation: "hold" },
      ],
      scale: [{ frame: 0, value: [1, 1], interpolation: "linear" }],
      rotation: [{ frame: 15, value: 45, interpolation: "linear" }],
      opacity: [{ frame: 0, value: 0, interpolation: "linear" }],
    }, 60)).toBeNull();
  });
});
