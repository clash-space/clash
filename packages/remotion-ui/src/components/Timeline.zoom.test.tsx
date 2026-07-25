// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorStaticState } from '@master-clash/remotion-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';
import { timeline } from './timeline/styles';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const ZoomProbe = () => {
  const { zoom } = useEditorStaticState();
  return <output aria-label="Timeline zoom state">{zoom}</output>;
};

function renderTimeline() {
  window.currentDraggedItem = null;
  return render(
    <EditorProvider
      initialState={{
        fps: 30,
        durationInFrames: 900,
        zoom: 1,
        tracks: [
          {
            id: 'visual',
            name: 'Image',
            items: [
              {
                id: 'clip',
                type: 'solid',
                color: '#f5ddd8',
                from: 0,
                durationInFrames: 90,
              },
            ],
          },
        ],
      }}
    >
      <Timeline />
      <ZoomProbe />
    </EditorProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Timeline zoom', () => {
  it('renders the normalized primary clip as a soft bubble inside its floating track surface', () => {
    const { container } = renderTimeline();
    const item = container.querySelector('.timeline-item') as HTMLElement;

    expect(item.style.borderRadius).toBe('8px');
    expect(item.style.border).toBe('1px solid transparent');
    expect(item.style.boxShadow).not.toBe('');
    expect(item.style.height).toBe('80px');
  });

  it('merges the flat label rail into the header surface with one quiet divider', () => {
    const { container } = renderTimeline();
    const labelColumn = container.querySelector('.timeline-workspace > div:first-child') as HTMLElement;
    const header = container.querySelector('[data-timeline-header]') as HTMLElement;

    expect(labelColumn.style.borderRight).toBe(
      '1px solid var(--clash-timeline-border-subtle, #f0ede7)',
    );
    expect(labelColumn.style.background).toBe(header.style.backgroundColor);
    expect(labelColumn.style.background).toBe('var(--clash-warm-surface, #fffefd)');
    expect(container.querySelectorAll('[data-track-bubble-edge="label"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-track-bubble-edge="lane"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-track-label-divider]')).toHaveLength(2);
  });

  it('uses one continuous warm-surface background with warm-yellow track pills', () => {
    const { container } = renderTimeline();
    const ruler = container.querySelector('[data-timeline-ruler]') as HTMLElement;
    const editingCanvas = container.querySelector('[data-timeline-editing-canvas]') as HTMLElement;

    expect(ruler).not.toBeNull();
    expect(ruler.style.background).toBe('var(--clash-warm-surface, #fffefd)');
    expect(editingCanvas.style.background).toBe('var(--clash-warm-surface, #fffefd)');
    expect((container.querySelector('[data-track-bubble-surface]') as HTMLElement).style.backgroundColor)
      .toBe('var(--clash-warm-page, #fbfaf7)');
  });

  it('keeps an empty primary lane mounted on a new Timeline', () => {
    const { container } = render(
      <EditorProvider initialState={{ tracks: [], primaryTrackId: null }}>
        <Timeline />
      </EditorProvider>,
    );

    const primaryLane = container.querySelector('[data-track-lane][data-primary-track="true"]');
    expect(primaryLane).not.toBeNull();
    expect(container.querySelector('.track-labels-panel')?.textContent).toContain('Media');
  });

  it('allows short Timelines to zoom out below 100%', async () => {
    renderTimeline();

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(false);
    fireEvent.click(zoomOut);

    await waitFor(() => {
      expect(Number(screen.getByLabelText('Timeline zoom state').textContent)).toBeLessThan(1);
    });
  });

  it('keeps the frame under the pointer stable during modifier-wheel zoom', async () => {
    const { container } = renderTimeline();
    const viewport = container.querySelector('.tracks-viewport') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      scrollWidth: { configurable: true, value: 5000 },
    });
    viewport.scrollLeft = 100;
    viewport.getBoundingClientRect = () => ({
      bottom: 300,
      height: 240,
      left: 0,
      right: 800,
      top: 60,
      width: 800,
      x: 0,
      y: 60,
      toJSON: () => ({}),
    });

    const anchorOffset = 200;
    const frameBefore = (viewport.scrollLeft + anchorOffset - timeline.contentInsetLeft) / 2;
    fireEvent.wheel(viewport, {
      clientX: anchorOffset,
      ctrlKey: true,
      deltaY: -120,
    });

    await waitFor(() => {
      const zoom = Number(screen.getByLabelText('Timeline zoom state').textContent);
      expect(zoom).toBeGreaterThan(1);
      const frameAfter = (viewport.scrollLeft + anchorOffset - timeline.contentInsetLeft) / (2 * zoom);
      expect(frameAfter).toBeCloseTo(frameBefore, 4);
    });
  });
});
