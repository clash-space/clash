import { describe, expect, it } from 'vitest';
import {
  applyTimelineCommand,
  validateTimelineDsl,
  type TimelineCommand,
} from './timelineSemantics';
import type { TimelineDsl, Track, VideoItem } from './types';

const clip = (id: string, sourceNodeId: string, from: number, durationInFrames: number): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  sourceNodeId,
  assetId: `${sourceNodeId}-asset`,
  from,
  durationInFrames,
});

const dsl = (tracks: Track[]): TimelineDsl => ({
  tracks,
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 300,
});

describe('validateTimelineDsl', () => {
  it('reports unresolved references, invalid timing, and track role mismatches', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'music',
          name: 'Music',
          role: 'music',
          items: [
            {
              ...clip('bad', 'missing-node', -4, 0),
              type: 'video',
            },
          ],
        },
      ]),
      { resolvableSourceNodeIds: new Set(['existing-node']) },
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'item.unresolved_source',
      'item.invalid_from',
      'item.invalid_duration',
      'track.role_item_mismatch',
    ]);
  });

  it('accepts compatible resolved clips and reports derived duration', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'main',
          name: 'Main',
          role: 'primary-video',
          items: [clip('a', 'node-a', 10, 40)],
        },
      ]),
      { resolvableSourceNodeIds: new Set(['node-a']) },
    );

    expect(result.ok).toBe(true);
    expect(result.durationInFrames).toBe(50);
  });
});

describe('applyTimelineCommand', () => {
  it('adds a referenced clip to a role-compatible track and extends duration', () => {
    const command: TimelineCommand = {
      type: 'add_clip',
      trackId: 'main',
      sourceNodeId: 'node-a',
      assetId: 'asset-a',
      itemType: 'video',
      from: 30,
      durationInFrames: 45,
    };

    const result = applyTimelineCommand(
      dsl([{ id: 'main', name: 'Main', role: 'primary-video', items: [] }]),
      command,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl.tracks[0].items[0]).toMatchObject({
      type: 'video',
      sourceNodeId: 'node-a',
      assetId: 'asset-a',
      from: 30,
      durationInFrames: 45,
    });
    expect(result.dsl.durationInFrames).toBe(75);
  });

  it('rejects commands that would violate track role semantics', () => {
    const result = applyTimelineCommand(
      dsl([{ id: 'music', name: 'Music', role: 'music', items: [] }]),
      {
        type: 'add_clip',
        trackId: 'music',
        sourceNodeId: 'node-a',
        itemType: 'video',
        from: 0,
        durationInFrames: 30,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain('track.role_item_mismatch');
  });

  it('trims a media clip by updating sourceStartInFrames when moving the left edge', () => {
    const result = applyTimelineCommand(
      dsl([{ id: 'main', name: 'Main', role: 'primary-video', items: [clip('a', 'node-a', 10, 50)] }]),
      { type: 'trim_clip', trackId: 'main', itemId: 'a', from: 20, durationInFrames: 40 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl.tracks[0].items[0]).toMatchObject({
      from: 20,
      durationInFrames: 40,
      sourceStartInFrames: 10,
    });
  });
});
