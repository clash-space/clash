// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageRenderer } from './ImageRenderer';

describe('ImageRenderer', () => {
  it('tiles a still thumbnail at its intrinsic ratio instead of stretching it with clip width', () => {
    const { container } = render(
      <ImageRenderer
        item={{ id: 'still', type: 'image', src: '/still.png', from: 0, durationInFrames: 300 } as any}
        asset={{ id: 'still-asset', type: 'image', src: '/still.png', createdAt: 1 } as any}
        width={2_400}
        height={40}
        pixelsPerFrame={8}
      />,
    );

    const thumbnail = container.querySelector('[data-image-thumbnail-renderer]') as HTMLElement;
    expect(thumbnail.getAttribute('data-image-thumbnail-renderer')).toBe('intrinsic-ratio-tiles');
    expect(thumbnail.style.backgroundRepeat).toBe('repeat-x');
    expect(thumbnail.style.backgroundSize).toBe('auto 100%');
  });
});
