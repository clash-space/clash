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

  it('adds a short-drama text overlay to an overlay track', () => {
    const command: TimelineCommand = {
      type: 'add_clip',
      trackId: 'overlays',
      sourceNodeId: 'scene-1-text',
      itemType: 'text',
      from: 30,
      durationInFrames: 90,
      id: 'subtitle-hook',
      text: '你以为我只是便利店店员？',
    };

    const result = applyTimelineCommand(
      dsl([{ id: 'overlays', name: 'Overlays', role: 'overlay', items: [] }]),
      command,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl.tracks[0].items[0]).toMatchObject({
      id: 'subtitle-hook',
      type: 'text',
      text: '你以为我只是便利店店员？',
      from: 30,
      durationInFrames: 90,
    });
  });

  it('rejects plain text items on subtitle tracks so they cannot masquerade as caption systems', () => {
    const result = applyTimelineCommand(
      dsl([{ id: 'subtitles', name: 'Subtitles', role: 'subtitle', items: [] }]),
      {
        type: 'add_clip',
        trackId: 'subtitles',
        sourceNodeId: 'scene-1-text',
        itemType: 'text',
        from: 30,
        durationInFrames: 90,
        id: 'subtitle-hook',
        text: '你以为我只是便利店店员？',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain('track.role_item_mismatch');
  });

  it('accepts a HyperFrames-style MG composition item on an overlay track', () => {
    const timeline = dsl([
      {
        id: 'overlays',
        name: 'Overlays',
        role: 'overlay',
        items: [
          {
            id: 'mg-lower-third',
            type: 'composition',
            compositionKind: 'motion-graphics',
            runtime: 'html',
            compositionId: 'lower-third',
            sourcePath: 'compositions/lower-third/index.html',
            from: 30,
            durationInFrames: 90,
            spec: {
              id: 'lower-third',
              width: 1080,
              height: 1920,
              fps: 30,
              durationInFrames: 90,
              layers: [],
            },
          },
        ] as any,
      },
    ]);

    const result = validateTimelineDsl(timeline as any);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects unsafe or unresolved composition items', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'remote-component',
              type: 'composition',
              compositionKind: 'motion-graphics',
              runtime: 'react',
              compositionId: 'remote-component',
              sourcePath: 'https://example.com/component.tsx',
              from: 0,
              durationInFrames: 30,
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_composition');
  });

  it('rejects React or Remotion composition items without a rendered preview asset', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'react-chart',
              type: 'composition',
              compositionKind: 'custom',
              runtime: 'remotion',
              compositionId: 'react-chart',
              sourcePath: 'compositions/react-chart/Composition.tsx',
              from: 0,
              durationInFrames: 60,
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_composition');
    expect(result.issues.map((issue) => issue.path)).toContain('tracks[0].items[0].renderedAssetPath');
  });

  it('accepts React or Remotion composition items once a local rendered preview asset exists', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'react-chart',
              type: 'composition',
              compositionKind: 'custom',
              runtime: 'remotion',
              compositionId: 'react-chart',
              sourcePath: 'compositions/react-chart/Composition.tsx',
              renderedAssetPath: 'assets/renders/react-chart.webm',
              from: 0,
              durationInFrames: 60,
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts structured caption cues on a subtitle track', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'subtitles',
          name: 'Subtitles',
          role: 'subtitle',
          items: [
            {
              id: 'captions-main',
              type: 'caption',
              from: 0,
              durationInFrames: 120,
              language: 'zh-CN',
              cues: [
                {
                  id: 'cue-1',
                  startFrame: 0,
                  durationInFrames: 45,
                  text: '你以为我只是便利店店员？',
                  wordIds: ['w1', 'w2'],
                  sourceStartFrame: 0,
                  sourceEndFrame: 45,
                },
                {
                  id: 'cue-2',
                  startFrame: 45,
                  durationInFrames: 50,
                  text: '其实这是我的复仇剧本。',
                  wordIds: ['w3'],
                  sourceStartFrame: 90,
                  sourceEndFrame: 140,
                },
              ],
              wordRefs: [
                { id: 'w1', text: '你以为我', sourceStartFrame: 0, sourceEndFrame: 20 },
                { id: 'w2', text: '只是便利店店员？', sourceStartFrame: 20, sourceEndFrame: 45 },
                { id: 'w3', text: '其实这是我的复仇剧本。', sourceStartFrame: 90, sourceEndFrame: 140 },
              ],
              sourceToOutputMap: [
                { sourceStartFrame: 0, sourceEndFrame: 45, outputStartFrame: 0, outputEndFrame: 45 },
                { sourceStartFrame: 90, sourceEndFrame: 140, outputStartFrame: 45, outputEndFrame: 95 },
              ],
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects caption cues whose word references or source ranges cannot be verified', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'subtitles',
          name: 'Subtitles',
          role: 'subtitle',
          items: [
            {
              id: 'captions-main',
              type: 'caption',
              from: 0,
              durationInFrames: 60,
              cues: [
                {
                  id: 'cue-1',
                  startFrame: 0,
                  durationInFrames: 30,
                  text: '大家好',
                  wordIds: ['w1', 'w-missing'],
                  sourceStartFrame: 0,
                  sourceEndFrame: 30,
                },
              ],
              wordRefs: [
                { id: 'w1', text: '大家', sourceStartFrame: 0, sourceEndFrame: 12 },
              ],
              sourceToOutputMap: [
                { sourceStartFrame: 60, sourceEndFrame: 90, outputStartFrame: 0, outputEndFrame: 30 },
              ],
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_caption');
  });

  it('rejects malformed caption cues instead of treating subtitles as plain text clips', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'subtitles',
          name: 'Subtitles',
          role: 'subtitle',
          items: [
            {
              id: 'captions-main',
              type: 'caption',
              from: 0,
              durationInFrames: 90,
              cues: [
                { id: 'cue-empty', startFrame: 30, durationInFrames: 0, text: '' },
              ],
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_caption');
  });

  it('accepts copy-on-write derived asset overlays on an overlay track', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'logo-callout-derived',
              type: 'derived-overlay',
              from: 30,
              durationInFrames: 90,
              assetId: 'asset-logo-callout',
              mediaType: 'image',
              src: 'assets/derived/logo-callout.webp',
              sourceAssetId: 'asset-logo-original',
              derivedAssetId: 'asset-logo-callout',
              derivation: {
                kind: 'crop',
                description: 'transparent logo callout cropped from approved packshot',
              },
              properties: { x: 0, y: 0, width: 0.4, height: 0.4, opacity: 1 },
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects derived overlays that do not preserve copy-on-write lineage', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'bad-derived',
              type: 'derived-overlay',
              from: 0,
              durationInFrames: 30,
              mediaType: 'video',
              src: 'https://example.invalid/overlay.mp4',
              sourceAssetId: 'asset-a',
              derivedAssetId: 'asset-a',
              derivation: { kind: 'caption-burn' },
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_derived_overlay');
  });

  it('rejects derived overlays whose backing asset id does not match derivedAssetId', () => {
    const result = validateTimelineDsl(
      dsl([
        {
          id: 'overlays',
          name: 'Overlays',
          role: 'overlay',
          items: [
            {
              id: 'bad-derived-asset-link',
              type: 'derived-overlay',
              from: 0,
              durationInFrames: 30,
              assetId: 'asset-unrelated',
              mediaType: 'image',
              src: 'assets/derived/logo-callout.webp',
              sourceAssetId: 'asset-logo-original',
              derivedAssetId: 'asset-logo-callout',
              derivation: { kind: 'crop' },
            },
          ] as any,
        },
      ]) as any,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('item.invalid_derived_overlay');
    expect(result.issues.map((issue) => issue.path)).toContain('tracks[0].items[0].assetId');
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
