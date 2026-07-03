import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AssetPanel primitives', () => {
  it('routes asset panel buttons and file input through remotion-ui primitives', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/AssetPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('./ui/controls');
    expect(source).toContain('<RemotionButton');
    expect(source).toContain('<RemotionFileInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });
});
