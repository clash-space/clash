import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readComponent(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
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
    expect(source).not.toContain('onMouseDown={(e) =>');
  });

  it('routes v2 canvas pan gestures through the gesture primitive', () => {
    const source = readComponent('InteractiveCanvasV2.tsx');

    expect(source).toContain('./ui/gesture');
    expect(source).toContain('useDragGesture');
    expect(source).not.toContain("window.addEventListener('mousemove', handlePanMove");
    expect(source).not.toContain("window.removeEventListener('mousemove', handlePanMove");
  });

  it('routes v2 canvas item transform gestures through the gesture primitive', () => {
    const source = readComponent('InteractiveCanvasV2.tsx');

    expect(source).toContain('canvasTransformGestureBind');
    expect(source).not.toContain("window.addEventListener('mousemove', handleMouseMove");
    expect(source).not.toContain("window.removeEventListener('mousemove', handleMouseMove");
    expect(source).not.toContain("window.addEventListener('mouseup', handleMouseUp");
    expect(source).not.toContain("window.removeEventListener('mouseup', handleMouseUp");
  });
});
