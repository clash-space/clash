import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('gesture primitives', () => {
  it('only exposes gesture hooks used by the editor', () => {
    const source = readFileSync(new URL('./gesture.ts', import.meta.url), 'utf8');

    expect(source).toContain('useDrag as useDragGesture');
    expect(source).not.toContain('useMove');
  });
});
