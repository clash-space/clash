/**
 * Tests for the global obscured-windows pre-pass that the transition system
 * (phase B) relies on. The renderer reads this map per-clip to decide
 * whether to soft-hide itself while a transition layer paints. Bug here =
 * "transition flashes ghost copy of underlying clip".
 */
import { describe, it, expect } from 'vitest';
import type { Track, VideoItem, TransitionItem } from '@clash/remotion-core';
import { buildObscuredWindowsByItemId, isFrameObscured } from './VideoComposition';

const makeVideo = (id: string, from: number, dur: number): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  from,
  durationInFrames: dur,
});

const makeTransition = (
  id: string,
  from: number,
  dur: number,
  fromItemId: string,
  toItemId: string,
  transitionType: TransitionItem['transitionType'] = 'crossfade',
): TransitionItem => ({
  id,
  type: 'transition',
  from,
  durationInFrames: dur,
  fromItemId,
  toItemId,
  transitionType,
});

describe('buildObscuredWindowsByItemId', () => {
  it('returns an empty map when there are no transitions', () => {
    const tracks: Track[] = [
      { id: 'v', name: '', items: [makeVideo('a', 0, 60), makeVideo('b', 60, 60)] },
    ];
    expect(buildObscuredWindowsByItemId(tracks).size).toBe(0);
  });

  it('marks both fromItemId and toItemId as obscured during the transition window', () => {
    const tracks: Track[] = [
      { id: 'v', name: '', items: [makeVideo('a', 0, 100), makeVideo('b', 100, 100)] },
      { id: 'tx', name: '', items: [makeTransition('t1', 85, 30, 'a', 'b')] },
    ];
    const windows = buildObscuredWindowsByItemId(tracks);
    expect(windows.get('a')).toEqual([{ from: 85, end: 114 }]);
    expect(windows.get('b')).toEqual([{ from: 85, end: 114 }]);
  });

  it('aggregates multiple transitions involving the same clip', () => {
    const tracks: Track[] = [
      {
        id: 'tx',
        name: '',
        items: [
          // The same clip "a" is the from-side of one transition and the to-side of another.
          makeTransition('t1', 0, 30, 'prev', 'a'),
          makeTransition('t2', 100, 20, 'a', 'next'),
        ],
      },
    ];
    const windows = buildObscuredWindowsByItemId(tracks);
    expect(windows.get('a')).toHaveLength(2);
    expect(windows.get('a')).toEqual([
      { from: 0, end: 29 },
      { from: 100, end: 119 },
    ]);
  });

  it('handles transitions that reference clips on a different track', () => {
    const tracks: Track[] = [
      { id: 'v', name: '', items: [makeVideo('shot-A', 0, 150)] },
      { id: 'over', name: '', items: [makeVideo('shot-B', 120, 100)] },
      { id: 'tx', name: '', items: [makeTransition('t1', 130, 20, 'shot-A', 'shot-B')] },
    ];
    const windows = buildObscuredWindowsByItemId(tracks);
    expect(windows.get('shot-A')).toEqual([{ from: 130, end: 149 }]);
    expect(windows.get('shot-B')).toEqual([{ from: 130, end: 149 }]);
  });

  it('skips transitions with empty fromItemId / toItemId without crashing', () => {
    const tracks: Track[] = [
      {
        id: 'tx',
        name: '',
        items: [
          { ...makeTransition('t1', 0, 30, '', 'b'), fromItemId: '' },
          { ...makeTransition('t2', 60, 30, 'a', ''), toItemId: '' },
        ] as TransitionItem[],
      },
    ];
    const windows = buildObscuredWindowsByItemId(tracks);
    // 'b' picked up from t1's toItemId; 'a' picked up from t2's fromItemId.
    expect(windows.get('a')).toEqual([{ from: 60, end: 89 }]);
    expect(windows.get('b')).toEqual([{ from: 0, end: 29 }]);
    expect(windows.has('')).toBe(false);
  });
});

describe('isFrameObscured', () => {
  it('returns false for empty / undefined windows', () => {
    expect(isFrameObscured(50, undefined)).toBe(false);
    expect(isFrameObscured(50, [])).toBe(false);
  });

  it('returns true at endpoints (inclusive)', () => {
    expect(isFrameObscured(85, [{ from: 85, end: 114 }])).toBe(true);
    expect(isFrameObscured(114, [{ from: 85, end: 114 }])).toBe(true);
  });

  it('returns false just outside the window', () => {
    expect(isFrameObscured(84, [{ from: 85, end: 114 }])).toBe(false);
    expect(isFrameObscured(115, [{ from: 85, end: 114 }])).toBe(false);
  });

  it('checks all windows when there are multiple', () => {
    const ws = [
      { from: 0, end: 29 },
      { from: 100, end: 119 },
    ];
    expect(isFrameObscured(50, ws)).toBe(false);
    expect(isFrameObscured(0, ws)).toBe(true);
    expect(isFrameObscured(110, ws)).toBe(true);
    expect(isFrameObscured(120, ws)).toBe(false);
  });
});
