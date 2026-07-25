import { describe, expect, it } from 'vitest';
import {
  createOneSidedWaveformPath,
  getWaveformBuildCacheKey,
  getWaveformSampleCount,
} from './waveformPresentation';

describe('timeline waveform presentation', () => {
  it('uses editing-grade sampling density with bounded decode cost', () => {
    expect(getWaveformSampleCount(1)).toBe(1024);
    expect(getWaveformSampleCount(32.6)).toBe(3130);
    expect(getWaveformSampleCount(200)).toBe(8192);
  });

  it('uses the full compact lane height for a one-sided area waveform', () => {
    expect(createOneSidedWaveformPath({
      waveform: [1],
      width: 10,
      height: 20,
      volume: 1,
    })).toBe('M 0 20 L 0 0 L 10 0 L 10 20 Z');
  });

  it('builds embedded video audio without creating a separate audio item', () => {
    expect(getWaveformBuildCacheKey('video', '/talking-head.mp4', 3130))
      .toBe('video:/talking-head.mp4:3130');
    expect(getWaveformBuildCacheKey('audio', '/voice.wav', 1024))
      .toBe('audio:/voice.wav:1024');
    expect(getWaveformBuildCacheKey('image', '/still.png', 1024)).toBeNull();
  });
});
