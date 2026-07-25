export const TIMELINE_KEYFRAME_CHANNELS = [
  "position",
  "scale",
  "rotation",
  "opacity",
] as const;

export type TimelineKeyframeChannel = (typeof TIMELINE_KEYFRAME_CHANNELS)[number];
export type TimelineKeyframeInterpolation = "hold" | "linear";

export type TimelineVectorKeyframe = {
  frame: number;
  value: readonly [number, number];
  interpolation: TimelineKeyframeInterpolation;
};

export type TimelineScalarKeyframe = {
  frame: number;
  value: number;
  interpolation: TimelineKeyframeInterpolation;
};

export type TimelineItemKeyframes = {
  position?: TimelineVectorKeyframe[];
  scale?: TimelineVectorKeyframe[];
  rotation?: TimelineScalarKeyframe[];
  opacity?: TimelineScalarKeyframe[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateTimelineItemKeyframes(
  value: unknown,
  durationInFrames = 0,
): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return "keyframes must be an object";
  const supportedChannels = new Set<string>(TIMELINE_KEYFRAME_CHANNELS);
  for (const channel of Object.keys(value)) {
    if (!supportedChannels.has(channel)) {
      return `keyframes.${channel} is unsupported`;
    }
  }
  for (const channel of TIMELINE_KEYFRAME_CHANNELS) {
    const keyframes = value[channel];
    if (keyframes === undefined) continue;
    if (!Array.isArray(keyframes)) return `keyframes.${channel} must be an array`;
    const seenFrames = new Set<number>();
    for (const keyframe of keyframes) {
      if (!isRecord(keyframe)) return `keyframes.${channel} entries must be objects`;
      if (
        typeof keyframe.frame !== "number"
        || !Number.isInteger(keyframe.frame)
        || keyframe.frame < 0
        || keyframe.frame >= durationInFrames
      ) {
        return `keyframes.${channel} frame must be an integer between 0 and ${durationInFrames - 1}`;
      }
      if (seenFrames.has(keyframe.frame)) {
        return `keyframes.${channel} contains duplicate frame ${keyframe.frame}`;
      }
      seenFrames.add(keyframe.frame);
      if (keyframe.interpolation !== "hold" && keyframe.interpolation !== "linear") {
        return `keyframes.${channel} interpolation must be hold or linear`;
      }
      if (channel === "position" || channel === "scale") {
        const vector = keyframe.value;
        const isFiniteVector = Array.isArray(vector)
          && vector.length === 2
          && vector.every((component) => typeof component === "number" && Number.isFinite(component));
        if (!isFiniteVector) {
          return channel === "position"
            ? "keyframes.position value must be a finite [x, y] tuple"
            : "keyframes.scale value must be a non-negative finite [x, y] tuple";
        }
        if (channel === "scale" && vector.some((component) => component < 0)) {
          return "keyframes.scale value must be a non-negative finite [x, y] tuple";
        }
      } else if (channel === "rotation") {
        if (typeof keyframe.value !== "number" || !Number.isFinite(keyframe.value)) {
          return "keyframes.rotation value must be finite";
        }
      } else if (
        typeof keyframe.value !== "number"
        || !Number.isFinite(keyframe.value)
        || keyframe.value < 0
        || keyframe.value > 1
      ) {
        return "keyframes.opacity value must be between 0 and 1";
      }
    }
  }
  return null;
}
