import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TimelineItem primitives', () => {
  it('routes item edit/delete controls through remotion-ui primitives', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineTextInput');
    expect(source).toContain('<TimelineColorInput');
    expect(source).toContain('<TimelineIconButton');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('<motion.button');
  });

  it('routes text edit keyboard commit and cancel through the text input primitive', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onCommit={handleTextSave}');
    expect(source).toContain('onCancel={handleTextCancel}');
    expect(source).not.toContain('onKeyDown={(e) =>');
  });

  it('routes fade and volume sliders through the timeline slider primitive', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/timeline-slider');
    expect(source).toContain('<TimelineSlider');
    expect(source).not.toContain('role="slider"');
    expect(source).not.toContain("window.addEventListener('mousemove', handleFadeDrag");
    expect(source).not.toContain("window.addEventListener('mousemove', handleVolumeDrag");
  });

  it('routes resize handle drags through the gesture primitive', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/gesture');
    expect(source).toContain('useDragGesture');
    expect(source).not.toContain("document.addEventListener('mousemove', handleMouseMove");
    expect(source).not.toContain("document.removeEventListener('mousemove', handleMouseMove");
  });
});
