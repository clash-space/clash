import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AssetPanel primitives', () => {
  it('routes asset panel buttons and file input through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./AssetPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('./ui/controls');
    expect(source).toContain('<RemotionButton');
    expect(source).toContain('<RemotionFileInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });
});
