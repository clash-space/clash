import { describe, expect, it } from 'vitest';
import { TIMELINE_LIBRARY_CATEGORIES } from '@clash/shared-types/timeline-library';
import { buildTimelineLibraryDemoPlan } from './timelineLibraryDemoPlan';

describe('buildTimelineLibraryDemoPlan', () => {
  it('builds a contiguous fifteen-second reel', () => {
    const plan = buildTimelineLibraryDemoPlan(30);
    expect(plan.totalFrames).toBe(450);
    expect(plan.segments[0].from).toBe(0);
    for (let index = 1; index < plan.segments.length; index += 1) {
      const previous = plan.segments[index - 1];
      expect(plan.segments[index].from).toBe(previous.from + previous.durationInFrames);
    }
  });

  it('covers every typed Timeline Library category', () => {
    const plan = buildTimelineLibraryDemoPlan(30);
    const categories = new Set(plan.segments.flatMap((segment) => segment.categories));
    expect([...categories].sort()).toEqual([...TIMELINE_LIBRARY_CATEGORIES].sort());
  });
});
