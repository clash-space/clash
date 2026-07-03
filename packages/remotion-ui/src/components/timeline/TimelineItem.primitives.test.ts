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
});
