import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TimelineItem primitives', () => {
  it('routes inline text editing through the remotion-ui input primitive', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineTextInput');
    expect(source).not.toContain('<input');
    expect(source).not.toContain('<motion.button');
  });

  it('routes text edit keyboard commit and cancel through the text input primitive', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onCommit={handleTextSave}');
    expect(source).toContain('onCancel={handleTextCancel}');
    expect(source).not.toContain('onKeyDown={(e) =>');
  });

  it('keeps compact fade and volume hit targets independent from item drag', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-audio-fade-handle');
    expect(source).toContain('data-volume-db-hit-target');
    expect(source).toContain('role="slider"');
    expect(source).not.toContain('fadeSliderWidth');
    expect(source).not.toContain('inset: 0,\n            width: \'100%\',\n            height: \'100%\'');
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

  it('bounds the video filmstrip canvas backing store independently of its visual width', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getBoundedFilmstripCanvasWidth');
    expect(source).toContain('const filmstripCanvasWidth = React.useMemo(');
    expect(source).toContain('targetCanvas.width = filmstripCanvasWidth;');
    expect(source).toContain('fullVideoPixelWidth: filmstripCanvasWidth');
  });

  it('uses a persisted cover as a placeholder without blocking an adaptive filmstrip', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-filmstrip-renderer="adaptive-sample-buckets"');
    expect(source).toContain('sampleCount: filmstripSampleCount');
    expect(source).not.toContain('asset?.thumbnail ||\n      attemptedFilmstripKeyRef.current === filmstripCacheKey');
  });

  it('falls back to the clip duration when video asset metadata has no duration', () => {
    const source = readFileSync(new URL('./TimelineItem.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const resolvedMediaDurationSeconds = asset?.duration');
    expect(source).toContain('duration: resolvedMediaDurationSeconds');
    expect(source).not.toContain('!asset?.duration ||\n      !filmstripCacheKey');
  });
});
