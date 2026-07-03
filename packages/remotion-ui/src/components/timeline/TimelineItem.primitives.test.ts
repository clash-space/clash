import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TimelineItem primitives', () => {
  it('routes item edit/delete controls through remotion-ui primitives', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineItem.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineTextInput');
    expect(source).toContain('<TimelineColorInput');
    expect(source).toContain('<TimelineIconButton');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('<motion.button');
  });

  it('routes fade and volume sliders through the timeline slider primitive', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineItem.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/timeline-slider');
    expect(source).toContain('<TimelineSlider');
    expect(source).not.toContain('role="slider"');
    expect(source).not.toContain("window.addEventListener('mousemove', handleFadeDrag");
    expect(source).not.toContain("window.addEventListener('mousemove', handleVolumeDrag");
  });
});
