import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  computeClipAnimationStyle,
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
  OffthreadVideo: ({
    src,
    style,
    pauseWhenBuffering,
    volume,
  }: {
    src: string;
    style?: React.CSSProperties;
    pauseWhenBuffering?: boolean;
    volume?: number | ((frame: number) => number);
  }) => (
    React.createElement('video', {
      'data-remotion': 'offthread-video',
      'data-pause-when-buffering': String(pauseWhenBuffering),
      'data-effective-volume': typeof volume === 'function' ? volume(mockedFrame) : volume,
      src,
      style,
    })
  ),
  Audio: ({
    src,
    crossOrigin,
    'data-timeline-audio': timelineAudio,
    volume,
  }: {
    src: string;
    crossOrigin?: string;
    'data-timeline-audio'?: string;
    volume?: number | ((frame: number) => number);
  }) => React.createElement('audio', {
    'data-remotion': 'audio',
    'data-timeline-audio': timelineAudio,
    'data-effective-volume': typeof volume === 'function' ? volume(mockedFrame) : volume,
    crossOrigin,
    src,
  }),
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
  it('renders a keyframed clip mask at the item-local frame', () => {
    mockedFrame = 10;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'visuals',
          name: 'Visuals',
          category: 'visual',
          items: [{
            id: 'masked-image',
            type: 'image',
            src: 'image.png',
            from: 30,
            durationInFrames: 21,
            mask: {
              shape: 'ellipse',
              position: [50, 50],
              size: [70, 70],
              rotation: 0,
              feather: 0,
              inverted: false,
            },
            keyframes: {
              maskPosition: [
                { frame: 0, value: [20, 50], interpolation: 'linear' },
                { frame: 20, value: [80, 50], interpolation: 'linear' },
              ],
              maskRotation: [
                { frame: 0, value: 0, interpolation: 'linear' },
                { frame: 20, value: 90, interpolation: 'linear' },
              ],
            },
          }],
        }] as any,
      }),
    );

    expect(markup).toContain('mask-image:url(');
    expect(markup).toContain('matrix(0.7071%200.3977%20-1.2571%200.7071');
  });

  it('applies keyframed opacity to visual item types that provide their own visibility opacity', () => {
    mockedFrame = 10;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'visuals',
          name: 'Visuals',
          category: 'visual',
          items: [{
            id: 'background',
            type: 'solid',
            color: '#000000',
            from: 0,
            durationInFrames: 21,
            properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 },
            keyframes: {
              opacity: [
                { frame: 0, value: 0, interpolation: 'linear' },
                { frame: 20, value: 1, interpolation: 'linear' },
              ],
            },
          }],
        }],
      }),
    );

    expect(markup).toContain('opacity:0.5');
  });

  it('multiplies keyframed opacity with clip entrance opacity', () => {
    mockedFrame = 5;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'visuals',
          name: 'Visuals',
          category: 'visual',
          items: [{
            id: 'clip',
            type: 'video',
            src: 'clip.mp4',
            from: 0,
            durationInFrames: 30,
            properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 },
            entranceAnimation: { type: 'fade', durationInFrames: 10 },
            keyframes: {
              opacity: [
                { frame: 0, value: 0.5, interpolation: 'hold' },
                { frame: 29, value: 0.5, interpolation: 'linear' },
              ],
            },
          }],
        }],
      }),
    );

    const entranceOpacity = computeClipAnimationStyle({
      frame: 5,
      durationInFrames: 30,
      entranceAnimation: { type: 'fade', durationInFrames: 10 },
    }).opacity ?? 1;
    expect(markup).toContain(`opacity:${entranceOpacity * 0.5}`);
  });

  it('computes deterministic entrance and exit styles from explicit frame durations', () => {
    expect(computeClipAnimationStyle({
      frame: 0,
      durationInFrames: 90,
      entranceAnimation: { type: 'fade', durationInFrames: 10 },
    })).toMatchObject({
      opacity: 0,
    });

    expect(computeClipAnimationStyle({
      frame: 5,
      durationInFrames: 90,
      entranceAnimation: { type: 'zoom-in', durationInFrames: 10 },
    }).transform).toContain('scale(');

    expect(computeClipAnimationStyle({
      frame: 89,
      durationInFrames: 90,
      exitAnimation: { type: 'slide-left', durationInFrames: 10 },
    }).transform).toContain('translateX(-8%)');
  });

  it('marks timeline audio as CORS-safe for live level capture', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
          {
            id: 'audio',
            name: 'Audio',
            items: [
              {
                id: 'voice',
                type: 'audio',
                src: 'http://127.0.0.1:49321/assets/voice.wav',
                from: 0,
                durationInFrames: 90,
              },
            ],
          },
        ] as any,
      }),
    );

    expect(markup).toContain('data-timeline-audio=""');
    expect(markup).toContain('crossorigin="anonymous"');
  });

  it('uses audioGainDb as the canonical renderer gain ahead of legacy volume', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'audio',
          name: 'Audio',
          category: 'audio',
          items: [{
            id: 'voice',
            type: 'audio',
            src: 'voice.wav',
            from: 0,
            durationInFrames: 90,
            audioGainDb: 8.6,
            volume: 0.5,
          }],
        }] as any,
      }),
    );

    expect(markup).toContain('data-effective-volume="2.691');
  });

  it('uses frame-explicit audio fade fields in the renderer', () => {
    mockedFrame = 15;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'audio',
          name: 'Audio',
          category: 'audio',
          items: [{
            id: 'voice',
            type: 'audio',
            src: 'voice.wav',
            from: 0,
            durationInFrames: 90,
            audioGainDb: 0,
            audioFadeInFrames: 30,
            audioFadeOutFrames: 15,
          }],
        }] as any,
      }),
    );
    mockedFrame = 0;

    expect(markup).toContain('data-effective-volume="0.5"');
  });

  it('ducks a music clip while spoken media is active', () => {
    mockedFrame = 20;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
          {
            id: 'voice',
            name: 'Voiceover',
            role: 'narration',
            category: 'audio',
            items: [{
              id: 'voice-clip',
              type: 'audio',
              src: 'voice.wav',
              from: 10,
              durationInFrames: 30,
            }],
          },
          {
            id: 'music',
            name: 'Music',
            role: 'music',
            category: 'audio',
            items: [{
              id: 'music-clip',
              type: 'audio',
              src: 'music.wav',
              from: 0,
              durationInFrames: 90,
              audioGainDb: 0,
              audioDucking: {
                amountDb: -18,
                attackFrames: 6,
                releaseFrames: 12,
              },
            }],
          },
        ] as any,
      }),
    );
    mockedFrame = 0;

    expect(markup).toContain('src="/api/assets/view/music.wav"');
    expect(markup).toContain('data-effective-volume="0.1258');
  });

  it('preserves legacy volume zero as actual silence', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'audio',
          name: 'Audio',
          category: 'audio',
          items: [{
            id: 'muted',
            type: 'audio',
            src: 'muted.wav',
            from: 0,
            durationInFrames: 90,
            volume: 0,
          }],
        }] as any,
      }),
    );

    expect(markup).toContain('data-effective-volume="0"');
  });

  it('holds playback while a video frame is buffering instead of flashing through it', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [{
          id: 'video',
          name: 'Video',
          role: 'primary-video',
          items: [{
            id: 'clip',
            type: 'video',
            src: 'http://127.0.0.1:49321/assets/clip.mp4',
            from: 0,
            durationInFrames: 90,
          }],
        }] as any,
      }),
    );

    expect(markup).toContain('data-pause-when-buffering="true"');
  });

  it('renders explicit mediaFit and plain-text layout fields from the Timeline DSL', () => {
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
          {
            id: 'visuals',
            name: 'Visuals',
            items: [
              {
                id: 'cover-video',
                type: 'video',
                src: 'video.mp4',
                mediaFit: 'cover',
                from: 0,
                durationInFrames: 90,
              },
              {
                id: 'contained-image',
                type: 'image',
                src: 'image.png',
                mediaFit: 'contain',
                from: 0,
                durationInFrames: 90,
              },
              {
                id: 'left-title',
                type: 'text',
                text: 'Launch',
                color: '#ffffff',
                textAlign: 'left',
                letterSpacingPx: 3,
                lineHeight: 1.3,
                from: 0,
                durationInFrames: 90,
              },
            ],
          },
        ] as any,
      }),
    );

    expect(markup).toContain('object-fit:cover');
    expect(markup).toContain('object-fit:contain');
    expect(markup).toContain('text-align:left');
    expect(markup).toContain('letter-spacing:3px');
    expect(markup).toContain('line-height:1.3');
  });

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
                type: 'text',
                text: '第一句',
                color: '#ffffff',
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

  it('renders clip effect stacks and sticker assets in preview/export markup', () => {
    mockedFrame = 15;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
          {
            id: 'visuals',
            name: 'Visuals',
            items: [
              {
                id: 'still-with-look',
                type: 'image',
                src: 'assets/still.webp',
                from: 0,
                durationInFrames: 60,
                effects: [
                  { effectId: 'clash/punch-zoom', effectVersion: 1 },
                  { effectId: 'clash/monochrome', effectVersion: 1 },
                ],
              },
            ],
          },
          {
            id: 'stickers',
            name: 'Stickers',
            items: [
              {
                id: 'spark-sticker',
                type: 'sticker',
                src: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
                from: 0,
                durationInFrames: 60,
              },
            ],
          },
        ] as any,
        allNodes: new Map(),
      }),
    );

    expect(markup).toContain('filter:grayscale');
    expect(markup).toContain('scale(');
    expect(markup).toContain('data-sticker-item-id="spark-sticker"');
    expect(markup).toContain('src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"');
  });

  it('paints the transition target above its source so reveal masks are visible', () => {
    mockedFrame = 8;
    const markup = renderToStaticMarkup(
      React.createElement(VideoComposition, {
        tracks: [
          {
            id: 'transitions',
            name: 'Transitions',
            items: [
              {
                id: 'circle-wipe',
                type: 'transition',
                transitionType: 'circle-wipe',
                fromItemId: 'warm',
                toItemId: 'dark',
                from: 0,
                durationInFrames: 18,
              },
            ],
          },
          {
            id: 'sources',
            name: 'Sources',
            hidden: true,
            items: [
              {
                id: 'warm',
                type: 'solid',
                color: '#F7F2EA',
                from: 0,
                durationInFrames: 9,
                mask: {
                  shape: 'rectangle',
                  position: [50, 50],
                  size: [80, 60],
                  rotation: 0,
                  feather: 10,
                  inverted: false,
                },
              },
              {
                id: 'dark',
                type: 'solid',
                color: '#10151F',
                from: 9,
                durationInFrames: 9,
              },
            ],
          },
        ] as any,
      }),
    );
    mockedFrame = 0;

    const fromLayer = markup.indexOf('data-transition-role="from"');
    const toLayer = markup.indexOf('data-transition-role="to"');
    expect(fromLayer).toBeGreaterThan(-1);
    expect(toLayer).toBeGreaterThan(fromLayer);
    expect(markup).toContain('clip-path:circle(');
    expect(markup).toContain('mask-image:url(');
  });
});
