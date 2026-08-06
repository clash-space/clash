import { validateTimelineDsl as validateSharedTimelineDsl } from '@clash/shared-types';
import { describe, expect, it } from 'vitest';
import { validateTimelineDsl } from './timelineSemantics';
import type { TimelineDsl, Track, VideoItem } from './types';

const video = (
  id: string,
  sourceNodeId: string,
  from: number,
  durationInFrames: number,
): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  sourceNodeId,
  assetId: `${sourceNodeId}-asset`,
  from,
  durationInFrames,
});

const timeline = (tracks: Track[]): TimelineDsl => ({
  tracks,
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 300,
});

describe('shared Timeline semantic adapter', () => {
  it('reports canonical ruleIds for the same invalid role, duplicate, and transition fixture', () => {
    const invalid = timeline([
      {
        id: 'main',
        name: 'Main',
        role: 'primary-video',
        items: [
          video('a', 'node-a', 0, 30),
          video('b', 'node-b', 45, 30),
        ],
      },
      {
        id: 'transitions',
        name: 'Transitions',
        role: 'transition',
        items: [{
          id: 'transition-a-b',
          type: 'transition',
          transitionType: 'crossfade',
          fromItemId: 'a',
          toItemId: 'b',
          from: 25,
          durationInFrames: 10,
        }],
      },
      {
        id: 'music',
        name: 'Music',
        role: 'music',
        items: [video('a', 'node-duplicate', 90, 30)],
      },
    ]);

    const shared = validateSharedTimelineDsl(invalid);
    const core = validateTimelineDsl(invalid);

    expect(shared.ok).toBe(false);
    if (shared.ok) return;
    const canonicalRuleIds = shared.issues
      .map((issue) => issue.ruleId)
      .filter((ruleId) => [
        'timeline.item.duplicate-id',
        'timeline.track.role-item-mismatch',
        'timeline.transition.continuity',
      ].includes(ruleId))
      .sort();

    expect(canonicalRuleIds).toEqual([
      'timeline.item.duplicate-id',
      'timeline.track.role-item-mismatch',
      'timeline.transition.continuity',
    ]);
    expect(core.issues.map((issue) => issue.ruleId).filter(Boolean).sort())
      .toEqual(canonicalRuleIds);
  });

  it('maps canonical structured-caption failures onto the legacy caption APIs', () => {
    const plainSubtitle = timeline([{
      id: 'subtitles',
      name: 'Subtitles',
      role: 'subtitle',
      items: [{
        id: 'plain-subtitle',
        type: 'text',
        text: 'Plain text is not a structured caption',
        color: '#fff',
        from: 0,
        durationInFrames: 30,
      }],
    }]);
    const malformedStructuredCaption = timeline([{
      id: 'subtitles',
      name: 'Subtitles',
      role: 'subtitle',
      items: [{
        id: 'malformed-caption',
        type: 'text',
        text: 'Malformed',
        color: '#fff',
        from: 0,
        durationInFrames: 30,
        cues: [],
      }],
    }]);

    const plainIssue = validateTimelineDsl(plainSubtitle).issues.find(
      (issue) => issue.ruleId === 'timeline.caption.structured',
    );
    const structuredIssue = validateTimelineDsl(malformedStructuredCaption).issues.find(
      (issue) => issue.ruleId === 'timeline.caption.structured',
    );

    expect(plainIssue?.code).toBe('track.role_item_mismatch');
    expect(structuredIssue?.code).toBe('item.invalid_caption');
  });

  it('does not duplicate a canonical missing-source issue when resolver context is present', () => {
    const invalid = timeline([{
      id: 'main',
      name: 'Main',
      role: 'primary-video',
      items: [{
        id: 'missing-source',
        type: 'video',
        from: 0,
        durationInFrames: 30,
      } as VideoItem],
    }]);

    const issues = validateTimelineDsl(invalid, {
      resolvableSourceNodeIds: new Set(),
      resolvableAssetIds: new Set(),
    }).issues.filter((issue) => issue.code === 'item.unresolved_source');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe('timeline.item.source-required');
  });
});
