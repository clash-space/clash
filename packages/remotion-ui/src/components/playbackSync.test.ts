import { describe, expect, it } from 'vitest';
import {
  getPlaybackStartFrame,
  getPlaybackSyncAction,
  getTimelineEndDisplayFrame,
} from './playbackSync';

describe('playback sync frame boundaries', () => {
  it('restarts playback from the beginning at the final renderable frame', () => {
    expect(getPlaybackStartFrame(239, 240)).toBe(0);
    expect(getPlaybackStartFrame(240, 240)).toBe(0);
  });

  it('continues playback from frames before the final renderable frame', () => {
    expect(getPlaybackStartFrame(238, 240)).toBe(238);
  });

  it('uses the timeline endpoint for the ended display frame', () => {
    expect(getTimelineEndDisplayFrame(240)).toBe(240);
    expect(getTimelineEndDisplayFrame(0)).toBe(0);
  });

  it('seeks an explicit transcript target when playback is paused in the same update', () => {
    expect(getPlaybackSyncAction({
      wasPlaying: true,
      playing: false,
      currentFrame: 390,
      playerFrame: 680,
      durationInFrames: 978,
    })).toEqual({
      kind: 'pause',
      seekTo: 390,
      notifyFrame: null,
    });
  });

  it('does not issue a redundant seek when starting from the frame already shown', () => {
    expect(getPlaybackSyncAction({
      wasPlaying: false,
      playing: true,
      currentFrame: 390,
      playerFrame: 390,
      durationInFrames: 978,
    })).toEqual({
      kind: 'play',
      seekTo: null,
      notifyFrame: null,
    });
  });

  it('rewinds once before replaying from the timeline endpoint', () => {
    expect(getPlaybackSyncAction({
      wasPlaying: false,
      playing: true,
      currentFrame: 977,
      playerFrame: 977,
      durationInFrames: 978,
    })).toEqual({
      kind: 'play',
      seekTo: 0,
      notifyFrame: 0,
    });
  });
});
