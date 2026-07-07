import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  computeCompositionLayerStyle,
  selectCaptionCueAtFrame,
  VideoComposition,
} from './VideoComposition';

let mockedFrame = 0;

vi.mock('remotion', () => ({
  AbsoluteFill: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, style, ...props }, ref) => React.createElement(
      'div',
      { ref, 'data-remotion': 'absolute-fill', style, ...props },
      children,
    ),
  ),
  Sequence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  OffthreadVideo: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    React.createElement('video', { 'data-remotion': 'offthread-video', src, style })
  ),
  Audio: ({ src }: { src: string }) => React.createElement('audio', { 'data-remotion': 'audio', src }),
  Img: ({ src, style }: { src: string; style?: React.CSSProperties }) => (
    React.createElement('img', { 'data-remotion': 'img', src, style })
  ),
  useCurrentFrame: () => mockedFrame,
  useVideoConfig: () => ({ width: 1080, height: 1920, fps: 30, durationInFrames: 120 }),
  interpolate: (
    input: number,
    inputRange: [number, number],
    outputRange: [number, number],
  ) => {
    const [inMin, inMax] = inputRange;
    const [outMin, outMax] = outputRange;
    const t = inMax === inMin ? 1 : Math.min(1, Math.max(0, (input - inMin) / (inMax - inMin)));
    return outMin + (outMax - outMin) * t;
  },
}));

describe('composition preview helpers', () => {
  it('computes motion-graphics layer style by sequence frame', () => {
    const layer = {
      id: 'title',
      type: 'text' as const,
      from: 0,
      durationInFrames: 60,
      x: 100,
      y: 900,
      opacity: 0,
      scale: 1,
      rotation: 0,
      animations: [
        { property: 'x' as const, from: -400, to: 100, startFrame: 0, durationInFrames: 20, easing: 'easeOutCubic' as const },
        { property: 'opacity' as const, from: 0, to: 1, startFrame: 0, durationInFrames: 10, easing: 'linear' as const },
      ],
    };

    expect(computeCompositionLayerStyle(layer, 0)).toMatchObject({
      opacity: 0,
      transform: 'translate(-400px, 900px) scale(1) rotate(0deg)',
    });
    expect(computeCompositionLayerStyle(layer, 20)).toMatchObject({
      opacity: 1,
      transform: 'translate(100px, 900px) scale(1) rotate(0deg)',
    });
  });

  it('selects active caption cue from structured caption item', () => {
    const cues = [
      { id: 'a', startFrame: 0, durationInFrames: 30, text: '第一句' },
      { id: 'b', startFrame: 45, durationInFrames: 20, text: '第二句' },
    ];

    expect(selectCaptionCueAtFrame(cues, 0)?.id).toBe('a');
    expect(selectCaptionCueAtFrame(cues, 29)?.id).toBe('a');
    expect(selectCaptionCueAtFrame(cues, 30)).toBeNull();
    expect(selectCaptionCueAtFrame(cues, 45)?.text).toBe('第二句');
    expect(selectCaptionCueAtFrame(cues, 65)).toBeNull();
  });

  it('renders structural timeline items with inspectable preview contracts', () => {
    mockedFrame = 12;

    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
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
                    id: 'cue-hook',
                    startFrame: 0,
                    durationInFrames: 30,
                    text: '第一句',
                    wordIds: ['w1'],
                    sourceStartFrame: 0,
                    sourceEndFrame: 30,
                  },
                ],
                wordRefs: [{ id: 'w1', text: '第一句', sourceStartFrame: 0, sourceEndFrame: 30 }],
                sourceToOutputMap: [
                  { sourceStartFrame: 0, sourceEndFrame: 30, outputStartFrame: 0, outputEndFrame: 30 },
                ],
              },
            ],
          },
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
                from: 0,
                durationInFrames: 60,
                spec: {
                  layers: [
                    {
                      id: 'title',
                      type: 'text',
                      text: '重点',
                      from: 0,
                      durationInFrames: 60,
                      x: 32,
                      y: 40,
                    },
                  ],
                },
              },
              {
                id: 'logo-callout',
                type: 'derived-overlay',
                mediaType: 'image',
                assetId: 'asset-logo-callout',
                src: 'assets/derived/logo-callout.webp',
                sourceAssetId: 'asset-logo-original',
                derivedAssetId: 'asset-logo-callout',
                derivation: { kind: 'crop', description: 'copy-on-write logo callout' },
                from: 0,
                durationInFrames: 60,
              },
            ],
          },
        ] as any,
        allNodes: new Map([
          [
            'asset-logo-callout',
            {
              id: 'asset-logo-callout',
              type: 'image',
              data: {
                src: 'assets/derived/logo-callout.webp',
                naturalWidth: 512,
                naturalHeight: 512,
              },
            },
          ],
        ]),
      }),
    );

    expect(markup).toContain('data-caption-item-id="captions-main"');
    expect(markup).toContain('data-caption-cue-id="cue-hook"');
    expect(markup).toContain('第一句');
    expect(markup).toContain('data-composition-item-id="mg-lower-third"');
    expect(markup).toContain('data-composition-id="lower-third"');
    expect(markup).toContain('data-layer-id="title"');
    expect(markup).toContain('data-derived-source-asset-id="asset-logo-original"');
    expect(markup).toContain('data-derived-asset-id="asset-logo-callout"');
    expect(markup).toContain('src="/api/assets/view/assets/derived/logo-callout.webp"');
  });
});
