import { describe, expect, it } from 'vitest';
import type { Track } from '@clash/remotion-core';
import {
  createBrollTrack,
  getNextBrollTrackName,
} from './brollTrackNaming';

const track = (
  id: string,
  role: Track['role'],
  category: Track['category'],
): Track => ({
  id,
  name: id,
  role,
  category,
  items: [],
});

describe('B-roll track naming', () => {
  it('does not count the primary visual spine as an existing B-roll lane', () => {
    const primary = track('primary', 'b-roll', 'visual');

    expect(getNextBrollTrackName([primary], primary.id)).toBe('B-roll');
  });

  it('numbers only additional B-roll lanes', () => {
    const primary = track('primary', 'b-roll', 'visual');
    const firstBroll = track('b-roll-1', 'b-roll', 'visual');
    const overlay = track('overlay', 'overlay', 'visual');

    expect(getNextBrollTrackName(
      [primary, firstBroll, overlay],
      primary.id,
    )).toBe('B-roll 2');
  });

  it('creates a complete visual B-roll lane outside the component', () => {
    const primary = track('primary', 'b-roll', 'visual');

    expect(createBrollTrack({
      id: 'b-roll-new',
      tracks: [primary],
      primaryTrackId: primary.id,
    })).toEqual({
      id: 'b-roll-new',
      name: 'B-roll',
      role: 'b-roll',
      category: 'visual',
      items: [],
    });
  });
});
