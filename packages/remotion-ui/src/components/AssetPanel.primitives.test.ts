import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AssetPanel primitives', () => {
  it('routes asset panel buttons and file input through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('./ui/controls');
    expect(source).toContain('<RemotionButton');
    expect(source).toContain('<RemotionFileInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });

  it('supports a compact headerless media browser for an embedded editor', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('showHeader?: boolean');
    expect(source).toContain('compact?: boolean');
    expect(source).toContain('showUploadControls');
    expect(source).toContain('AssetThumbnail');
    expect(source).toContain('data-asset-list=""');
    expect(source).toContain('Timeline media');
    expect(source).toContain('{compact ? headerTrailingAction : null}');
  });

  it('uses stable image covers or placeholders instead of live video thumbnails', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('<video');
    expect(source).toContain('asset.thumbnail');
    expect(source).toContain('data-video-thumbnail-placeholder=""');
  });

  it('uses the Canvas sidebar semantic tokens and control rhythm in compact mode', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('bg-warm-surface');
    expect(source).toContain('border-warm-border');
    expect(source).toContain('bg-brand');
    expect(source).toContain('focus-visible:ring-brand/50');
    expect(source).toContain('headerTrailingAction?: React.ReactNode');
    expect(source).not.toContain('bg-[#fffdfb]');
    expect(source).not.toContain('bg-[#ff6b50]');
  });

  it('lets the editor grid position the rounded compact content panel', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');
    const headerIndex = source.indexOf('className="flex h-10 shrink-0 items-center border-b');
    const contentIndex = source.indexOf('data-asset-panel-body=""');

    expect(contentIndex).toBeGreaterThan(headerIndex);
    expect(source).toContain('data-asset-panel-body=""');
    expect(source).toContain("'clash-timeline-panel-surface rounded-matrix bg-warm-surface");
    expect(source).not.toContain('mb-[var(--clash-timeline-gutter)] ml-[var(--clash-timeline-gutter)] mt-[var(--clash-timeline-gutter)]');
  });
});
