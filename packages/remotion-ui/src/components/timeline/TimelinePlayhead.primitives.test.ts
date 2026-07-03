import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TimelinePlayhead primitives', () => {
  it('routes slider semantics and pointer seeking through the timeline slider primitive', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelinePlayhead.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/timeline-slider');
    expect(source).toContain('<TimelineSlider');
    expect(source).not.toContain('role="slider"');
    expect(source).not.toContain('onKeyDown={(e) =>');
    expect(source).not.toContain("document.addEventListener('mousemove'");
    expect(source).not.toContain("document.addEventListener('mouseup'");
  });
});
