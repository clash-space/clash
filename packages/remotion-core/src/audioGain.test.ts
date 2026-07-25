import { describe, expect, it } from 'vitest';
import {
  audioGainDbToLinear,
  buildAudioDuckingWindows,
  computeAudioDuckingMultiplier,
  resolveAudioFadeInFrames,
  resolveAudioFadeOutFrames,
  resolveAudioGainDb,
  resolveLinearAudioGain,
} from './audioGain';

describe('audio gain DSL compatibility', () => {
  it('uses the canonical dB field before the legacy linear field', () => {
    const item = { audioGainDb: 8.6, volume: 0.5 };

    expect(resolveAudioGainDb(item)).toBe(8.6);
    expect(resolveLinearAudioGain(item)).toBeCloseTo(2.6915, 4);
  });

  it('keeps legacy zero silent and converts legacy linear gain for the GUI', () => {
    expect(resolveLinearAudioGain({ volume: 0 })).toBe(0);
    expect(resolveAudioGainDb({ volume: 0 })).toBe(-60);
    expect(resolveAudioGainDb({ volume: 1 })).toBe(0);
  });

  it('prefers frame-explicit fade fields while reading legacy fields', () => {
    const item = {
      audioFadeInFrames: 12,
      audioFadeOutFrames: 18,
      audioFadeIn: 30,
      audioFadeOut: 40,
    };

    expect(resolveAudioFadeInFrames(item)).toBe(12);
    expect(resolveAudioFadeOutFrames(item)).toBe(18);
    expect(resolveAudioFadeInFrames({ audioFadeIn: 30 })).toBe(30);
    expect(resolveAudioFadeOutFrames({ audioFadeOut: 40 })).toBe(40);
  });

  it('maps the editor floor to silence and +12 dB to the expected gain', () => {
    expect(audioGainDbToLinear(-60)).toBe(0);
    expect(audioGainDbToLinear(12)).toBeCloseTo(3.9811, 4);
  });

  it('ramps ducking in dB before speech and restores it after speech', () => {
    const settings = { amountDb: -20, attackFrames: 10, releaseFrames: 20 };
    const windows = [{ from: 30, end: 60 }];

    expect(computeAudioDuckingMultiplier(settings, 20, windows)).toBe(1);
    expect(computeAudioDuckingMultiplier(settings, 25, windows)).toBeCloseTo(0.3162, 4);
    expect(computeAudioDuckingMultiplier(settings, 30, windows)).toBeCloseTo(0.1, 4);
    expect(computeAudioDuckingMultiplier(settings, 59, windows)).toBeCloseTo(0.1, 4);
    expect(computeAudioDuckingMultiplier(settings, 70, windows)).toBeCloseTo(0.3162, 4);
    expect(computeAudioDuckingMultiplier(settings, 80, windows)).toBe(1);
  });

  it('derives triggers only from audible, visible spoken-media tracks', () => {
    const item = (id: string, from: number, audioGainDb?: number) => ({
      id,
      type: 'audio' as const,
      src: `${id}.wav`,
      from,
      durationInFrames: 20,
      audioGainDb,
    });

    expect(buildAudioDuckingWindows([
      { id: 'voice', name: 'Voice', role: 'narration', items: [item('voice', 10)] },
      { id: 'dialogue', name: 'Dialogue', role: 'dialogue', items: [item('dialogue', 40)] },
      { id: 'music', name: 'Music', role: 'music', items: [item('music', 70)] },
      { id: 'muted', name: 'Muted voice', role: 'narration', items: [item('muted', 100, -60)] },
      { id: 'hidden', name: 'Hidden voice', role: 'narration', hidden: true, items: [item('hidden', 130)] },
    ])).toEqual([
      { from: 10, end: 30 },
      { from: 40, end: 60 },
    ]);
  });
});
