import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readComponent(name: string): string {
  return readFileSync(join(process.cwd(), 'packages/remotion-ui/src/components', name), 'utf8');
}

describe('InteractiveCanvas primitives', () => {
  it('routes canvas zoom controls through remotion-ui primitives', () => {
    for (const source of [
      readComponent('InteractiveCanvas.tsx'),
      readComponent('InteractiveCanvasV2.tsx'),
    ]) {
      expect(source).toContain('./ui/controls');
      expect(source).toContain('<RemotionIconButton');
      expect(source).not.toContain('<button');
    }
  });
});
