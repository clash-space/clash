export const TIMELINE_KEYFRAME_INTERPOLATIONS = ["hold", "linear"] as const;
export type TimelineKeyframeInterpolation = (typeof TIMELINE_KEYFRAME_INTERPOLATIONS)[number];

export const DEFAULT_TIMELINE_KEYFRAME_INTERPOLATION = "linear" satisfies TimelineKeyframeInterpolation;

export const TIMELINE_KEYFRAME_SAMPLING_POLICY = Object.freeze({
  frameSpace: "item-local",
  interpolationOwner: "left-keyframe",
  beforeFirstKeyframe: "use-first-keyframe-value",
  afterLastKeyframe: "use-last-keyframe-value",
  emptyChannelFallback: "matching-static-field",
  storageOrder: "ascending-frame-recommended-runtime-sorts",
} as const);

export type TimelineKeyframeSampleEntry<TValue> = {
  frame: number;
  value: TValue;
  interpolation: TimelineKeyframeInterpolation;
};

/**
 * Executable counterpart of TIMELINE_KEYFRAME_SAMPLING_POLICY. Runtime
 * consumers supply only the value-specific interpolation function.
 */
export function sampleTimelineKeyframeChannel<TValue>(
  keyframes: readonly TimelineKeyframeSampleEntry<TValue>[] | undefined,
  frame: number,
  fallback: TValue,
  interpolate: (left: TValue, right: TValue, progress: number) => TValue,
): TValue {
  if (!keyframes || keyframes.length === 0) return fallback;
  const sorted = [...keyframes].sort((left, right) => left.frame - right.frame);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  const rightIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  const right = sorted[rightIndex]!;
  if (right.frame === frame) return right.value;
  const left = sorted[rightIndex - 1]!;
  if (left.interpolation === "hold") return left.value;
  const progress = (frame - left.frame) / (right.frame - left.frame);
  return interpolate(left.value, right.value, progress);
}
