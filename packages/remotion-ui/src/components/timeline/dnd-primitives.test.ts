import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('timeline drag-and-drop primitives', () => {
  it('keeps timeline dnd-kit usage behind the remotion-ui dnd primitive boundary', () => {
    const timelineSource = readSource('packages/remotion-ui/src/components/Timeline.tsx');
    const itemSource = readSource('packages/remotion-ui/src/components/timeline/TimelineItem.tsx');

    expect(timelineSource).toContain('./ui/dnd');
    expect(itemSource).toContain('../ui/dnd');
    expect(timelineSource).not.toContain('@dnd-kit/');
    expect(itemSource).not.toContain('@dnd-kit/');
  });

  it('passes the tracks viewport through React refs instead of DOM queries', () => {
    const timelineSource = readSource('packages/remotion-ui/src/components/Timeline.tsx');
    const tracksContainerSource = readSource('packages/remotion-ui/src/components/timeline/TimelineTracksContainer.tsx');

    expect(timelineSource).toContain('tracksViewportRef');
    expect(tracksContainerSource).toContain('onViewportElementChange');
    expect(timelineSource).not.toContain('querySelector');
    expect(tracksContainerSource).not.toContain('querySelector');
  });

  it('targets timeline sliders through the slider primitive class instead of ARIA role selectors', () => {
    const timelineSource = readSource('packages/remotion-ui/src/components/Timeline.tsx');
    const sliderSource = readSource('packages/remotion-ui/src/components/ui/timeline-slider.tsx');

    expect(sliderSource).toContain('timeline-slider');
    expect(timelineSource).toContain('.timeline-slider:focus-visible');
    expect(timelineSource).not.toContain('[role="slider"]');
  });
});
