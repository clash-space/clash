// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomControl } from './TimelineControls';

afterEach(() => cleanup());

describe('ZoomControl', () => {
  it('maps the wide zoom range onto a logarithmic slider', () => {
    const onZoomChange = vi.fn();
    render(
      <ZoomControl
        zoom={0.4}
        min={0.02}
        max={8}
        onZoomChange={onZoomChange}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Timeline zoom' }) as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');
    expect(Number(slider.value)).toBeCloseTo(50, 4);

    fireEvent.change(slider, { target: { value: '100' } });
    expect(onZoomChange).toHaveBeenCalledWith(8);
  });

  it('provides real fit and 100% reset actions', () => {
    const onZoomToFit = vi.fn();
    const onZoomReset = vi.fn();
    render(
      <ZoomControl
        zoom={0.4}
        min={0.02}
        max={8}
        onZoomChange={() => {}}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onZoomToFit={onZoomToFit}
        onZoomReset={onZoomReset}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to fit' }));

    expect(onZoomReset).toHaveBeenCalledTimes(1);
    expect(onZoomToFit).toHaveBeenCalledTimes(1);
  });
});
