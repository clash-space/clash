import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PropertiesPanel primitives', () => {
  it('routes properties form controls through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./PropertiesPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('./ui/controls');
    expect(source).toContain('<RemotionButton');
    expect(source).toContain('<RemotionInput');
    expect(source).toContain('<RemotionSelect');
    expect(source).toContain('<RemotionTextarea');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('<textarea');
  });
});
