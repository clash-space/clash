// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineRuler } from './TimelineRuler';

afterEach(() => cleanup());

describe('TimelineRuler', () => {
  it('draws ticks from the top edge and places time labels below them', () => {
    const { container } = render(
      <TimelineRuler
        durationInFrames={300}
        pixelsPerFrame={1}
        fps={30}
        onSeek={vi.fn()}
        zoom={1}
        scrollLeft={0}
        viewportWidth={300}
      />,
    );

    const label = screen.getByText('00:00');
    const majorTick = label.parentElement?.querySelector('line');
    const minorTick = container.querySelector('svg > line');

    expect(majorTick?.getAttribute('y1')).toBe('0');
    expect(majorTick?.getAttribute('y2')).toBe('10');
    expect(label.getAttribute('y')).toBe('24');
    expect(minorTick?.getAttribute('y1')).toBe('0');
    expect(minorTick?.getAttribute('y2')).toBe('6');
  });

  it('accepts semantic surface tokens so non-media editors can reuse the ruler', () => {
    const { container } = render(
      <TimelineRuler
        durationInFrames={120}
        pixelsPerFrame={1}
        fps={30}
        onSeek={vi.fn()}
        zoom={1}
        scrollLeft={0}
        tokens={{
          background: 'var(--director-timeline-surface)',
          minorTick: 'var(--director-timeline-divider)',
          majorTick: 'var(--director-timeline-muted)',
          label: 'var(--director-timeline-label)',
        }}
      />,
    );

    const ruler = container.querySelector<HTMLElement>('[data-timeline-ruler]');
    const minorTick = container.querySelector<SVGLineElement>('svg > line');
    const label = screen.getByText('00:00');
    const majorTick = label.parentElement?.querySelector('line');

    expect(ruler?.style.background).toBe('var(--director-timeline-surface)');
    expect(minorTick?.getAttribute('stroke')).toBe('var(--director-timeline-divider)');
    expect(majorTick?.getAttribute('stroke')).toBe('var(--director-timeline-muted)');
    expect(label.getAttribute('fill')).toBe('var(--director-timeline-label)');
  });
});
