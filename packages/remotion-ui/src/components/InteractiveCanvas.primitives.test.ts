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

  it('routes base canvas pan gestures through the gesture primitive', () => {
    const source = readComponent('InteractiveCanvas.tsx');

    expect(source).toContain('./ui/gesture');
    expect(source).toContain('useDragGesture');
    expect(source).not.toContain("window.addEventListener('mousemove', handlePanMove");
    expect(source).not.toContain("window.removeEventListener('mousemove', handlePanMove");
  });
});
