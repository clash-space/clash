import { describe, expect, it } from 'vitest';
import { createWheelAxisLock } from './wheelAxisLock';

describe('timeline wheel axis lock', () => {
  it('keeps the first dominant axis for the whole trackpad gesture', () => {
    const lock = createWheelAxisLock({ releaseAfterMs: 140 });

    expect(lock.resolve({ deltaX: 42, deltaY: 5, now: 0 })).toEqual({
      axis: 'x',
      delta: 42,
    });
    expect(lock.resolve({ deltaX: 2, deltaY: 30, now: 60 })).toEqual({
      axis: 'x',
      delta: 2,
    });
    expect(lock.resolve({ deltaX: 2, deltaY: 30, now: 220 })).toEqual({
      axis: 'y',
      delta: 30,
    });
  });

  it('maps shift-wheel to horizontal scrolling without leaking vertical motion', () => {
    const lock = createWheelAxisLock();

    expect(lock.resolve({
      deltaX: 0,
      deltaY: 24,
      now: 0,
      shiftKey: true,
    })).toEqual({
      axis: 'x',
      delta: 24,
    });
  });
});
