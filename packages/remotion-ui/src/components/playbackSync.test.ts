import { describe, expect, it } from 'vitest';
import { getPlaybackStartFrame, getTimelineEndDisplayFrame } from './playbackSync';

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
});
