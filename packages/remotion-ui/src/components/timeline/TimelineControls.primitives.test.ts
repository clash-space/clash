import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TimelineControls primitives', () => {
  it('routes timeline buttons and range inputs through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./TimelineControls.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineIconButton');
    expect(source).toContain('<TimelineRangeInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });

  it('routes timeline tooltips through the shared tooltip primitive', () => {
    const source = readFileSync(new URL('./TimelineControls.tsx', import.meta.url), 'utf8');
    const tooltipSource = readFileSync(new URL('../ui/tooltip.tsx', import.meta.url), 'utf8');

    expect(tooltipSource).toContain('@ariakit/react');
    expect(source).toContain('../ui/tooltip');
    expect(source).toContain('<Tooltip label=');
    expect(source).not.toContain('window.addEventListener');
    expect(source).not.toContain('showTooltip');
    expect(source).not.toContain('title=');
  });
});
