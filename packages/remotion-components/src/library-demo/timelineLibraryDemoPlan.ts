import type { TimelineLibraryCategory } from '@clash/shared-types/timeline-library';

export type TimelineLibraryDemoSegmentId =
  | 'intro'
  | 'motion'
  | 'effects'
  | 'color'
  | 'transitions'
  | 'audio'
  | 'outro';

export type TimelineLibraryDemoSegment = {
  id: TimelineLibraryDemoSegmentId;
  from: number;
  durationInFrames: number;
  categories: TimelineLibraryCategory[];
};

export type TimelineLibraryDemoPlan = {
  segments: TimelineLibraryDemoSegment[];
  totalFrames: number;
};

const segmentSpecs: Array<{
  id: TimelineLibraryDemoSegmentId;
  seconds: number;
  categories: TimelineLibraryCategory[];
}> = [
  { id: 'intro', seconds: 1.2, categories: [] },
  { id: 'motion', seconds: 2.4, categories: ['text', 'stickers', 'motion-graphics', 'templates'] },
  { id: 'effects', seconds: 3, categories: ['fx', 'zoom', 'adjustments'] },
  { id: 'color', seconds: 2.4, categories: ['luts', 'filters'] },
  { id: 'transitions', seconds: 2.4, categories: ['transitions'] },
  { id: 'audio', seconds: 2.4, categories: ['sound-effects', 'audio-fx', 'captions'] },
  { id: 'outro', seconds: 1.2, categories: [] },
];

export function buildTimelineLibraryDemoPlan(fps: number): TimelineLibraryDemoPlan {
  let cursor = 0;
  const segments = segmentSpecs.map((spec) => {
    const durationInFrames = Math.round(spec.seconds * fps);
    const segment: TimelineLibraryDemoSegment = {
      id: spec.id,
      from: cursor,
      durationInFrames,
      categories: spec.categories,
    };
    cursor += durationInFrames;
    return segment;
  });
  return { segments, totalFrames: cursor };
}
