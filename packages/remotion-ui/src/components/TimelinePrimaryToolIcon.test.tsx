import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TimelinePrimaryToolIcon,
  type TimelinePrimaryToolIconId,
} from './TimelinePrimaryToolIcon';

const promotedTools: TimelinePrimaryToolIconId[] = [
  'media',
  'sound-effects',
  'text',
  'stickers',
  'fx',
  'captions',
  'filters',
];

describe('TimelinePrimaryToolIcon', () => {
  it('gives every promoted Timeline tool a distinct silhouette', () => {
    const signatures = promotedTools.map((tool) => renderToStaticMarkup(
      <TimelinePrimaryToolIcon tool={tool} />,
    ).replace(/ data-timeline-tool-icon="[^"]+"/, ''));

    expect(new Set(signatures).size).toBe(promotedTools.length);
  });

  it('keeps Text and Captions visually distinct', () => {
    const text = renderToStaticMarkup(<TimelinePrimaryToolIcon tool="text" />);
    const captions = renderToStaticMarkup(<TimelinePrimaryToolIcon tool="captions" />);

    expect(text).toContain('data-timeline-tool-icon="text"');
    expect(text).toContain('data-text-serif-icon=""');
    expect(text).not.toContain('M5 5h14M12 5v14M8.5 19h7');
    expect(captions).toContain('data-timeline-tool-icon="captions"');
    expect(text).not.toBe(captions);
  });

  it('uses a palette silhouette for Color instead of an Inspector-style slider glyph', () => {
    const color = renderToStaticMarkup(<TimelinePrimaryToolIcon tool="filters" />);

    expect(color).toContain('data-color-palette-icon=""');
    expect(color).not.toContain('M4 7h8m4 0h4');
  });

  it('uses clean, single-idea silhouettes for Graphics and Effects', () => {
    const graphics = renderToStaticMarkup(<TimelinePrimaryToolIcon tool="stickers" />);
    const effects = renderToStaticMarkup(<TimelinePrimaryToolIcon tool="fx" />);

    expect(graphics).toContain('data-graphics-layers-icon=""');
    expect(graphics).not.toContain('3.25 5.25 3.25');
    expect(effects).toContain('data-effects-wand-icon=""');
    expect(effects).not.toContain('fill="currentColor"');
  });
});
