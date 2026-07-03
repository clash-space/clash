import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TimelineControls primitives', () => {
  it('routes timeline buttons and range inputs through remotion-ui primitives', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineControls.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineIconButton');
    expect(source).toContain('<TimelineRangeInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });

  it('routes timeline tooltips through the shared tooltip primitive', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineControls.tsx'),
      'utf8',
    );
    const tooltipSource = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/ui/tooltip.tsx'),
      'utf8',
    );

    expect(tooltipSource).toContain('@ariakit/react');
    expect(source).toContain('../ui/tooltip');
    expect(source).toContain('<Tooltip label=');
    expect(source).not.toContain('window.addEventListener');
    expect(source).not.toContain('showTooltip');
    expect(source).not.toContain('title=');
  });
});
