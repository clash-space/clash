// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StickerItem } from '@clash/remotion-core';
import { StickerRenderer } from './StickerRenderer';

afterEach(() => cleanup());

describe('StickerRenderer', () => {
  it('renders the actual sticker thumbnail on the timeline', () => {
    const item: StickerItem = {
      id: 'spark',
      type: 'sticker',
      src: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
      from: 0,
      durationInFrames: 90,
    };
    render(<StickerRenderer item={item} asset={null} width={160} height={56} pixelsPerFrame={1} />);
    const image = screen.getByRole('img', { name: 'Sticker' }) as HTMLImageElement;
    expect(image.src).toContain('data:image/svg+xml');
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});
