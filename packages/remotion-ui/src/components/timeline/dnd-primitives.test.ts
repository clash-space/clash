import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('timeline drag-and-drop primitives', () => {
  it('keeps timeline dnd-kit usage behind the remotion-ui dnd primitive boundary', () => {
    const timelineSource = readSource('../Timeline.tsx');
    const itemSource = readSource('./TimelineItem.tsx');

    expect(timelineSource).toContain('./ui/dnd');
    expect(itemSource).toContain('../ui/dnd');
    expect(timelineSource).not.toContain('@dnd-kit/');
    expect(itemSource).not.toContain('@dnd-kit/');
  });

  it('passes the tracks viewport through React refs instead of DOM queries', () => {
    const timelineSource = readSource('../Timeline.tsx');
    const tracksContainerSource = readSource('./TimelineTracksContainer.tsx');

    expect(timelineSource).toContain('tracksViewportRef');
    expect(tracksContainerSource).toContain('onViewportElementChange');
    expect(timelineSource).not.toContain('querySelector');
    expect(tracksContainerSource).not.toContain('querySelector');
  });

  it('targets timeline sliders through the slider primitive class instead of ARIA role selectors', () => {
    const timelineSource = readSource('../Timeline.tsx');
    const sliderSource = readSource('../ui/timeline-slider.tsx');

    expect(sliderSource).toContain('timeline-slider');
    expect(timelineSource).toContain('.timeline-slider:focus-visible');
    expect(timelineSource).not.toContain('[role="slider"]');
  });

  it('captures sidebar asset payloads before the browser releases the drop event', () => {
    const timelineSource = readSource('../Timeline.tsx');
    const tracksSource = readSource('./TimelineTracksContainer.tsx');
    const emptyDropHandler = timelineSource.slice(
      timelineSource.indexOf('const handleTimelineDrop'),
      timelineSource.indexOf('const handleItemDragEnd'),
    );

    expect(emptyDropHandler.indexOf('const droppedAsset'))
      .toBeGreaterThan(-1);
    expect(emptyDropHandler).toContain('resolveAssetDropPayload');
    expect(emptyDropHandler.indexOf('const droppedAsset'))
      .toBeLessThan(emptyDropHandler.indexOf('setTimeout'));

    const insertedTrackDropStart = tracksSource.indexOf('// Otherwise, handle creating new items from assets');
    const insertedTrackDrop = tracksSource.slice(insertedTrackDropStart, insertedTrackDropStart + 8_000);
    expect(insertedTrackDrop.indexOf('const droppedAsset'))
      .toBeGreaterThan(-1);
    expect(insertedTrackDrop.indexOf('const droppedAsset'))
      .toBeLessThan(insertedTrackDrop.indexOf('setTimeout'));
  });

  it('lets the right-side editing canvas float directly on the Timeline background', () => {
    const timelineSource = readSource('../Timeline.tsx');
    const tracksSource = readSource('./TimelineTracksContainer.tsx');

    expect(timelineSource).toContain('{/* 标尺 */}');
    expect(tracksSource).toContain('data-timeline-editing-canvas=""');
    expect(tracksSource).toContain('className="tracks-viewport bg-transparent"');
    expect(tracksSource).not.toContain('tracks-viewport rounded-lg border');
    expect(tracksSource.indexOf('data-timeline-editing-canvas=""'))
      .toBeGreaterThan(tracksSource.indexOf('{/* 右侧轨道视口 */}'));
  });
});
