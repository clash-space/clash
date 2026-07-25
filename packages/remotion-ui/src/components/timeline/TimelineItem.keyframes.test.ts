import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ImageItem } from '@master-clash/remotion-core';
import * as TimelineItemModule from './TimelineItem';

const { getTimelineKeyframeMarkers } = TimelineItemModule;

describe('TimelineItem keyframe markers', () => {
  it('groups same-frame channels into one contained item-relative marker', () => {
    const item: ImageItem = {
      id: 'image',
      type: 'image',
      src: 'image.png',
      from: 120,
      durationInFrames: 21,
      keyframes: {
        position: [
          { frame: 0, value: [0, 0], interpolation: 'linear' },
          { frame: 10, value: [100, 0], interpolation: 'linear' },
        ],
        scale: [
          { frame: 0, value: [1, 1], interpolation: 'linear' },
        ],
        opacity: [
          { frame: 20, value: 0, interpolation: 'hold' },
        ],
      },
    };

    expect(getTimelineKeyframeMarkers(item)).toEqual([
      {
        channels: ['position', 'scale'],
        edge: 'start',
        frame: 0,
        leftPercent: 0,
      },
      {
        channels: ['position'],
        edge: 'middle',
        frame: 10,
        leftPercent: 50,
      },
      {
        channels: ['opacity'],
        edge: 'end',
        frame: 20,
        leftPercent: 100,
      },
    ]);
  });

  it('keeps destructive clip actions out of the keyframe marker corner', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-timeline-keyframe-marker=""');
    expect(source).toContain("marker.edge === 'start'");
    expect(source).toContain("marker.edge === 'end'");
    expect(source).not.toContain('Delete button - only on hover');
    expect(source).not.toContain('handleDeleteClick');
  });

  it('anchors endpoint caps to exact clip boundaries while keeping their hit targets inside', () => {
    const getMarkerLayout = (
      TimelineItemModule as typeof TimelineItemModule & {
        getTimelineKeyframeMarkerLayout?: (
          marker: ReturnType<typeof getTimelineKeyframeMarkers>[number],
        ) => {
          bottom: number;
          buttonLeft: number | string;
          buttonTransform: string;
          glyph: 'start-cap' | 'diamond' | 'end-cap';
        };
      }
    ).getTimelineKeyframeMarkerLayout;

    expect(getMarkerLayout).toBeTypeOf('function');
    expect(
      ([
        { edge: 'start', leftPercent: 0 },
        { edge: 'middle', leftPercent: 37.5 },
        { edge: 'end', leftPercent: 100 },
      ] as const).map((marker) =>
        getMarkerLayout?.({
          channels: ['position'],
          frame: 0,
          ...marker,
        }),
      ),
    ).toEqual([
      {
        bottom: 4,
        buttonLeft: 0,
        buttonTransform: 'none',
        glyph: 'start-cap',
      },
      {
        bottom: 4,
        buttonLeft: '37.5%',
        buttonTransform: 'translateX(-50%)',
        glyph: 'diamond',
      },
      {
        bottom: 4,
        buttonLeft: '100%',
        buttonTransform: 'translateX(-100%)',
        glyph: 'end-cap',
      },
    ]);
  });
});
