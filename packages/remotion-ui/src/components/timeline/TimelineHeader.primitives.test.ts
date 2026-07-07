import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TimelineHeader primitives', () => {
  it('routes the play control through remotion-ui button primitives', () => {
    const source = readFileSync(new URL('./TimelineHeader.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineIconButton');
    expect(source).not.toContain('<button');
  });
});
