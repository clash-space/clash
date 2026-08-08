// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { CompositionItem, DerivedOverlayItem, SubtitleTextItem } from '@master-clash/remotion-core';
import { afterEach, describe, expect, it } from 'vitest';
import { getRendererForItem, itemRendererRegistry } from './registry';

afterEach(() => cleanup());

const captionItem: SubtitleTextItem = {
  id: 'caption-main',
  type: 'text',
  text: '别再把字幕当另一种 item type',
  color: '#ffffff',
  from: 0,
  durationInFrames: 90,
  cues: [
    {
      id: 'cue-hook',
      startFrame: 0,
      durationInFrames: 30,
      text: '别再把字幕当 text clip',
      wordIds: ['w1'],
      sourceStartFrame: 0,
      sourceEndFrame: 30,
    },
  ],
  wordRefs: [{ id: 'w1', text: '字幕', sourceStartFrame: 0, sourceEndFrame: 30 }],
  sourceToOutputMap: [
    { sourceStartFrame: 0, sourceEndFrame: 30, outputStartFrame: 0, outputEndFrame: 30 },
  ],
};

const compositionItem: CompositionItem = {
  id: 'live-card',
  type: 'composition',
  from: 0,
  durationInFrames: 60,
  compositionKind: 'custom',
  runtime: 'remotion',
  compositionId: 'LiveCard',
  sourceNodeId: 'remotion-node-fixed',
  sourcePath: 'components/live-card.tsx',
};

const derivedOverlayItem: DerivedOverlayItem = {
  id: 'overlay-crop',
  type: 'derived-overlay',
  from: 0,
  durationInFrames: 45,
  mediaType: 'image',
  src: 'assets/derived/crop.webp',
  sourceAssetId: 'asset-source',
  derivedAssetId: 'asset-crop',
  assetId: 'asset-crop',
  derivation: { kind: 'crop', description: 'safe copy-on-write crop' },
};

describe('semantic timeline item renderers', () => {
  it('registers explicit timeline renderers instead of falling back to solid blocks', () => {
    expect(itemRendererRegistry.text?.name).toBe('TextRenderer');
    expect(getRendererForItem(captionItem).name).toBe('CaptionRenderer');
    expect(itemRendererRegistry.composition?.name).toBe('CompositionRenderer');
    expect(itemRendererRegistry['derived-overlay']?.name).toBe('DerivedOverlayRenderer');
  });

  it('renders subtitle-role items as Text while preserving cue lineage context', () => {
    const Renderer = getRendererForItem(captionItem);
    const { container } = render(
      <Renderer item={captionItem} asset={null} width={240} height={44} pixelsPerFrame={2} />,
    );

    expect(screen.queryByText('Text')).toBeNull();
    expect(screen.queryByText('Caption')).toBeNull();
    expect(screen.queryByText('1 cue')).toBeNull();
    expect(screen.getByText('别再把字幕当 text clip')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).dataset.timelineItemType).toBe('text');
    expect((container.firstElementChild as HTMLElement).dataset.textKind).toBe('subtitle');
    expect((container.firstElementChild as HTMLElement).title).toContain('1 word ref');
    expect((container.firstElementChild as HTMLElement).style.backgroundColor)
      .toBe('var(--clash-timeline-item-text, #e4e2de)');
    expect((container.firstElementChild as HTMLElement).style.color)
      .toBe('var(--clash-timeline-item-text-foreground, #343434)');
  });

  it('renders live Remotion composition identity without legacy layer metadata', () => {
    const Renderer = getRendererForItem(compositionItem);
    const { container } = render(
      <Renderer item={compositionItem} asset={null} width={260} height={44} pixelsPerFrame={2} />,
    );

    expect(screen.getByText('R')).toBeTruthy();
    expect(screen.getByText('LiveCard')).toBeTruthy();
    expect(screen.getByText('remotion')).toBeTruthy();
    expect(screen.queryByText(/layer/)).toBeNull();
    expect((container.firstElementChild as HTMLElement).dataset.timelineItemType).toBe('composition');
    expect((container.firstElementChild as HTMLElement).title).toContain('components/live-card.tsx');
  });

  it('renders derived overlays as copy-on-write assets with source and derived ids', () => {
    const Renderer = getRendererForItem(derivedOverlayItem);
    const { container } = render(
      <Renderer item={derivedOverlayItem} asset={null} width={260} height={44} pixelsPerFrame={2} />,
    );

    expect(screen.getByText('Derived overlay')).toBeTruthy();
    expect(screen.getByText('crop')).toBeTruthy();
    expect(screen.getByText('asset-source -> asset-crop')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).dataset.timelineItemType).toBe('derived-overlay');
    expect((container.firstElementChild as HTMLElement).title).toContain('copy-on-write');
  });
});
