import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TimelineTrack primitives', () => {
  it('does not render native or fake track controls without committed state paths', () => {
    const source = readFileSync(new URL('./TimelineTrack.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('toggle mute');
    expect(source).not.toContain('toggle solo');
    expect(source).not.toContain('toggle lock');
    expect(source).not.toContain('setIsEditingName');
  });
});
