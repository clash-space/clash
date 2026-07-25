import type {
  TimelineItemKeyframes,
  TimelineKeyframeChannel,
  TimelineScalarKeyframe,
  TimelineVectorKeyframe,
} from "@clash/shared-types";

export type TimelineKeyframeSample = {
  position: readonly [number, number];
  scale: readonly [number, number];
  rotation: number;
  opacity: number;
};

function sampleScalar(
  keyframes: readonly TimelineScalarKeyframe[] | undefined,
  frame: number,
  fallback: number,
): number {
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
  return left.value + ((right.value - left.value) * progress);
}

function sampleVector(
  keyframes: readonly TimelineVectorKeyframe[] | undefined,
  frame: number,
  fallback: readonly [number, number],
): readonly [number, number] {
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
  return [
    left.value[0] + ((right.value[0] - left.value[0]) * progress),
    left.value[1] + ((right.value[1] - left.value[1]) * progress),
  ];
}

export function sampleTimelineKeyframes(
  keyframes: TimelineItemKeyframes | undefined,
  itemLocalFrame: number,
  fallback: TimelineKeyframeSample,
): TimelineKeyframeSample {
  return {
    position: sampleVector(keyframes?.position, itemLocalFrame, fallback.position),
    scale: sampleVector(keyframes?.scale, itemLocalFrame, fallback.scale),
    rotation: sampleScalar(keyframes?.rotation, itemLocalFrame, fallback.rotation),
    opacity: sampleScalar(keyframes?.opacity, itemLocalFrame, fallback.opacity),
  };
}

type TimelineKeyframe = TimelineScalarKeyframe | TimelineVectorKeyframe;

function channelKeyframes(
  keyframes: TimelineItemKeyframes | undefined,
  channel: TimelineKeyframeChannel,
): readonly TimelineKeyframe[] {
  return (keyframes?.[channel] ?? []) as readonly TimelineKeyframe[];
}

export function upsertTimelineKeyframe(
  keyframes: TimelineItemKeyframes | undefined,
  channel: TimelineKeyframeChannel,
  keyframe: TimelineKeyframe,
): TimelineItemKeyframes {
  const nextChannel = [
    ...channelKeyframes(keyframes, channel).filter((candidate) => candidate.frame !== keyframe.frame),
    keyframe,
  ].sort((left, right) => left.frame - right.frame);
  return {
    ...keyframes,
    [channel]: nextChannel,
  } as TimelineItemKeyframes;
}

export function removeTimelineKeyframe(
  keyframes: TimelineItemKeyframes | undefined,
  channel: TimelineKeyframeChannel,
  frame: number,
): TimelineItemKeyframes | undefined {
  if (!keyframes) return undefined;
  const nextChannel = channelKeyframes(keyframes, channel)
    .filter((keyframe) => keyframe.frame !== frame);
  const next = { ...keyframes } as Record<string, unknown>;
  if (nextChannel.length > 0) {
    next[channel] = nextChannel;
  } else {
    delete next[channel];
  }
  return Object.keys(next).length > 0 ? next as TimelineItemKeyframes : undefined;
}

export type AdjacentTimelineKeyframes = {
  previousFrame: number | null;
  hasCurrent: boolean;
  nextFrame: number | null;
};

export function findAdjacentTimelineKeyframes(
  keyframes: TimelineItemKeyframes | undefined,
  channel: TimelineKeyframeChannel,
  frame: number,
): AdjacentTimelineKeyframes {
  const frames = channelKeyframes(keyframes, channel)
    .map((keyframe) => keyframe.frame)
    .sort((left, right) => left - right);
  return {
    previousFrame: [...frames].reverse().find((candidate) => candidate < frame) ?? null,
    hasCurrent: frames.includes(frame),
    nextFrame: frames.find((candidate) => candidate > frame) ?? null,
  };
}

function interpolationAtFrame(
  keyframes: readonly TimelineKeyframe[],
  frame: number,
): TimelineKeyframe["interpolation"] {
  const sorted = [...keyframes].sort((left, right) => left.frame - right.frame);
  return [...sorted].reverse().find((keyframe) => keyframe.frame <= frame)?.interpolation
    ?? sorted[0]?.interpolation
    ?? "linear";
}

function sampleChannelValue(
  channel: TimelineKeyframeChannel,
  keyframes: readonly TimelineKeyframe[],
  frame: number,
): TimelineKeyframe["value"] {
  const first = keyframes[0]!;
  if (channel === "position" || channel === "scale") {
    return sampleVector(
      keyframes as readonly TimelineVectorKeyframe[],
      frame,
      first.value as readonly [number, number],
    );
  }
  return sampleScalar(
    keyframes as readonly TimelineScalarKeyframe[],
    frame,
    first.value as number,
  );
}

function sliceChannel(
  channel: TimelineKeyframeChannel,
  keyframes: readonly TimelineKeyframe[],
  startFrame: number,
  durationInFrames: number,
): TimelineKeyframe[] {
  if (keyframes.length === 0 || durationInFrames <= 0) return [];
  const endFrame = startFrame + durationInFrames - 1;
  const start: TimelineKeyframe = {
    frame: 0,
    value: sampleChannelValue(channel, keyframes, startFrame),
    interpolation: interpolationAtFrame(keyframes, startFrame),
  } as TimelineKeyframe;
  if (durationInFrames === 1) return [start];
  const middle = keyframes
    .filter((keyframe) => keyframe.frame > startFrame && keyframe.frame < endFrame)
    .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - startFrame }));
  const end: TimelineKeyframe = {
    frame: durationInFrames - 1,
    value: sampleChannelValue(channel, keyframes, endFrame),
    interpolation: "linear",
  } as TimelineKeyframe;
  return [start, ...middle, end];
}

export function sliceTimelineKeyframes(
  keyframes: TimelineItemKeyframes | undefined,
  startFrame: number,
  durationInFrames: number,
): TimelineItemKeyframes | undefined {
  if (!keyframes || durationInFrames <= 0) return undefined;
  const next: Record<string, unknown> = {};
  for (const channel of Object.keys(keyframes) as TimelineKeyframeChannel[]) {
    const sliced = sliceChannel(
      channel,
      channelKeyframes(keyframes, channel),
      startFrame,
      durationInFrames,
    );
    if (sliced.length > 0) next[channel] = sliced;
  }
  return Object.keys(next).length > 0 ? next as TimelineItemKeyframes : undefined;
}

export function rippleDeleteTimelineKeyframes(
  keyframes: TimelineItemKeyframes | undefined,
  startFrame: number,
  endFrame: number,
  durationInFrames: number,
): TimelineItemKeyframes | undefined {
  if (!keyframes || durationInFrames <= 0) return undefined;
  const clampedStart = Math.max(0, Math.min(durationInFrames, startFrame));
  const clampedEnd = Math.max(clampedStart, Math.min(durationInFrames, endFrame));
  if (clampedEnd <= clampedStart) return keyframes;
  if (clampedStart === 0) {
    return sliceTimelineKeyframes(
      keyframes,
      clampedEnd,
      durationInFrames - clampedEnd,
    );
  }
  if (clampedEnd === durationInFrames) {
    return sliceTimelineKeyframes(keyframes, 0, clampedStart);
  }

  const left = sliceTimelineKeyframes(keyframes, 0, clampedStart);
  const right = sliceTimelineKeyframes(
    keyframes,
    clampedEnd,
    durationInFrames - clampedEnd,
  );
  const next: Record<string, unknown> = {};
  for (const channel of Object.keys(keyframes) as TimelineKeyframeChannel[]) {
    const leftChannel = channelKeyframes(left, channel);
    const rightChannel = channelKeyframes(right, channel).map((keyframe) => ({
      ...keyframe,
      frame: keyframe.frame + clampedStart,
    }));
    const combined = [...leftChannel, ...rightChannel];
    if (combined.length > 0) next[channel] = combined;
  }
  return Object.keys(next).length > 0 ? next as TimelineItemKeyframes : undefined;
}
