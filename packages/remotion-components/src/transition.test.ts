import { describe, it, expect } from 'vitest';
import { computeTransitionStyle } from './VideoComposition';

describe('computeTransitionStyle', () => {
  describe('crossfade', () => {
    it('opacity ramps for from and to', () => {
      expect(computeTransitionStyle('crossfade', 0, 'from')).toEqual({ opacity: 1 });
      expect(computeTransitionStyle('crossfade', 0, 'to')).toEqual({ opacity: 0 });
      expect(computeTransitionStyle('crossfade', 0.5, 'from')).toEqual({ opacity: 0.5 });
      expect(computeTransitionStyle('crossfade', 0.5, 'to')).toEqual({ opacity: 0.5 });
      expect(computeTransitionStyle('crossfade', 1, 'from')).toEqual({ opacity: 0 });
      expect(computeTransitionStyle('crossfade', 1, 'to')).toEqual({ opacity: 1 });
    });

    it('clamps progress outside [0, 1]', () => {
      expect(computeTransitionStyle('crossfade', -0.5, 'from')).toEqual({ opacity: 1 });
      expect(computeTransitionStyle('crossfade', 1.5, 'to')).toEqual({ opacity: 1 });
    });
  });

  describe('push-left', () => {
    it('from slides off to the left, to slides in from the right', () => {
      expect(computeTransitionStyle('push-left', 0, 'from')).toEqual({ transform: 'translateX(0%)' });
      expect(computeTransitionStyle('push-left', 0, 'to')).toEqual({ transform: 'translateX(100%)' });
      expect(computeTransitionStyle('push-left', 0.5, 'from')).toEqual({ transform: 'translateX(-50%)' });
      expect(computeTransitionStyle('push-left', 0.5, 'to')).toEqual({ transform: 'translateX(50%)' });
      expect(computeTransitionStyle('push-left', 1, 'from')).toEqual({ transform: 'translateX(-100%)' });
      expect(computeTransitionStyle('push-left', 1, 'to')).toEqual({ transform: 'translateX(0%)' });
    });
  });

  describe('push-right', () => {
    it('from slides off to the right, to slides in from the left', () => {
      expect(computeTransitionStyle('push-right', 0, 'from')).toEqual({ transform: 'translateX(0%)' });
      expect(computeTransitionStyle('push-right', 0, 'to')).toEqual({ transform: 'translateX(-100%)' });
      expect(computeTransitionStyle('push-right', 1, 'from')).toEqual({ transform: 'translateX(100%)' });
      expect(computeTransitionStyle('push-right', 1, 'to')).toEqual({ transform: 'translateX(0%)' });
    });
  });

  describe('circle-wipe', () => {
    it('from has no special style; to is revealed via a growing circle clip-path', () => {
      expect(computeTransitionStyle('circle-wipe', 0, 'from')).toEqual({});
      expect(computeTransitionStyle('circle-wipe', 0, 'to')).toEqual({
        clipPath: 'circle(0% at 50% 50%)',
      });
      expect(computeTransitionStyle('circle-wipe', 0.5, 'to')).toEqual({
        clipPath: 'circle(35.5% at 50% 50%)',
      });
      expect(computeTransitionStyle('circle-wipe', 1, 'to')).toEqual({
        clipPath: 'circle(71% at 50% 50%)',
      });
    });
  });

  describe('slide-up / slide-down', () => {
    it('slide-up moves from up and to in from the bottom', () => {
      expect(computeTransitionStyle('slide-up', 0, 'from')).toEqual({ transform: 'translateY(0%)' });
      expect(computeTransitionStyle('slide-up', 0, 'to')).toEqual({ transform: 'translateY(100%)' });
      expect(computeTransitionStyle('slide-up', 1, 'from')).toEqual({ transform: 'translateY(-100%)' });
      expect(computeTransitionStyle('slide-up', 1, 'to')).toEqual({ transform: 'translateY(0%)' });
    });

    it('slide-down moves from down and to in from the top', () => {
      expect(computeTransitionStyle('slide-down', 1, 'from')).toEqual({ transform: 'translateY(100%)' });
      expect(computeTransitionStyle('slide-down', 1, 'to')).toEqual({ transform: 'translateY(0%)' });
    });
  });

  describe('wipe-left / wipe-right', () => {
    it('wipe-left reveals to-side from the left via shrinking inset on the right', () => {
      expect(computeTransitionStyle('wipe-left', 0, 'from')).toEqual({});
      expect(computeTransitionStyle('wipe-left', 0, 'to')).toEqual({ clipPath: 'inset(0 100% 0 0)' });
      expect(computeTransitionStyle('wipe-left', 0.5, 'to')).toEqual({ clipPath: 'inset(0 50% 0 0)' });
      expect(computeTransitionStyle('wipe-left', 1, 'to')).toEqual({ clipPath: 'inset(0 0% 0 0)' });
    });

    it('wipe-right reveals to-side from the right via shrinking inset on the left', () => {
      expect(computeTransitionStyle('wipe-right', 0, 'to')).toEqual({ clipPath: 'inset(0 0 0 100%)' });
      expect(computeTransitionStyle('wipe-right', 1, 'to')).toEqual({ clipPath: 'inset(0 0 0 0%)' });
    });
  });

  describe('zoom-in', () => {
    it('to-side scales up + fades in; from-side gently scales + fades out', () => {
      const fromStart = computeTransitionStyle('zoom-in', 0, 'from');
      expect(fromStart.opacity).toBe(1);
      expect(fromStart.transform).toContain('scale(1)');

      const toStart = computeTransitionStyle('zoom-in', 0, 'to');
      expect(toStart.opacity).toBe(0);
      expect(toStart.transform).toContain('scale(0.5)');

      const toEnd = computeTransitionStyle('zoom-in', 1, 'to');
      expect(toEnd.opacity).toBe(1);
      expect(toEnd.transform).toContain('scale(1)');
    });
  });
});
