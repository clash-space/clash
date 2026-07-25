export function getPlaybackStartFrame(currentFrame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 0;
  const finalRenderableFrame = Math.max(0, durationInFrames - 1);
  return currentFrame >= finalRenderableFrame ? 0 : Math.max(0, currentFrame);
}

export function getTimelineEndDisplayFrame(durationInFrames: number): number {
  return Math.max(0, durationInFrames);
}

type PlaybackSyncAction = {
  kind: 'idle' | 'pause' | 'play' | 'seek';
  seekTo: number | null;
  notifyFrame: number | null;
};

export function getPlaybackSyncAction(options: {
  wasPlaying: boolean;
  playing: boolean;
  currentFrame: number;
  playerFrame: number;
  durationInFrames: number;
}): PlaybackSyncAction {
  const {
    wasPlaying,
    playing,
    currentFrame,
    playerFrame,
    durationInFrames,
  } = options;
  const needsSeek = (targetFrame: number) => Math.abs(playerFrame - targetFrame) > 1;

  if (wasPlaying && !playing) {
    return {
      kind: 'pause',
      seekTo: needsSeek(currentFrame) ? currentFrame : null,
      notifyFrame: null,
    };
  }

  if (!wasPlaying && playing) {
    const startFrame = getPlaybackStartFrame(currentFrame, durationInFrames);
    return {
      kind: 'play',
      seekTo: needsSeek(startFrame) ? startFrame : null,
      notifyFrame: startFrame !== currentFrame ? startFrame : null,
    };
  }

  if (!playing && needsSeek(currentFrame)) {
    return {
      kind: 'seek',
      seekTo: currentFrame,
      notifyFrame: null,
    };
  }

  return {
    kind: 'idle',
    seekTo: null,
    notifyFrame: null,
  };
}
