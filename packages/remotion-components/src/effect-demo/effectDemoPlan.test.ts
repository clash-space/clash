import { describe, expect, it } from 'vitest';
import { buildEffectDemoPlan, effectProgress } from './effectDemoPlan';

describe('effect demo plan', () => {
  it('sequences three cinematic transitions with compact fps-based durations', () => {
    const plan = buildEffectDemoPlan(30);

    expect(plan.totalFrames).toBe(360);
    expect(plan.effects.map((effect) => ({ id: effect.effectId, from: effect.from, duration: effect.duration }))).toEqual([
      { id: 'clash/whip-pan', from: 45, duration: 90 },
      { id: 'clash/light-leak', from: 135, duration: 90 },
      { id: 'clash/flash-through-white', from: 225, duration: 90 },
    ]);
    expect(plan.outroFrom).toBe(315);
  });

  it('keeps both scenes readable around a 0.6 second transition window', () => {
    expect(effectProgress(0, 30)).toBe(0);
    expect(effectProgress(36, 30)).toBe(0);
    expect(effectProgress(45, 30)).toBeCloseTo(0.5, 5);
    expect(effectProgress(54, 30)).toBe(1);
    expect(effectProgress(89, 30)).toBe(1);
  });
});
