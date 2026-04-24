export function getPlaybackStartFrame(currentFrame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 0;
  const finalRenderableFrame = Math.max(0, durationInFrames - 1);
  return currentFrame >= finalRenderableFrame ? 0 : Math.max(0, currentFrame);
}

export function getTimelineEndDisplayFrame(durationInFrames: number): number {
  return Math.max(0, durationInFrames);
}
