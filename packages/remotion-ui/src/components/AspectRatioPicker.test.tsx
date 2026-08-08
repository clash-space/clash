// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AspectRatioPicker,
  closestAspectRatioOption,
  parseAspectRatio,
} from './AspectRatioPicker';

const OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'landscape', label: '16:9' },
  { value: 'square', label: '1:1' },
  { value: 'portrait', label: '9:16' },
];

const REFERENCE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'square', label: '1:1' },
  { value: 'tall', label: '2:3' },
  { value: 'landscape', label: '3:2' },
  { value: 'portrait', label: '3:4' },
  { value: 'photo', label: '4:3' },
  { value: 'phone', label: '9:16' },
  { value: 'widescreen', label: '16:9' },
  { value: 'custom', label: 'Custom' },
];

afterEach(cleanup);

describe('AspectRatioPicker', () => {
  it('parses canonical ratios from labels and provider-facing values', () => {
    expect(parseAspectRatio({ value: 'landscape_16_9', label: 'Widescreen 16:9' })).toBe(16 / 9);
    expect(parseAspectRatio({ value: '1024x1536', label: 'Portrait' })).toBe(2 / 3);
    expect(parseAspectRatio({ value: 'auto', label: 'Auto' })).toBeNull();
  });

  it('selects the nearest supported option for a dragged ratio', () => {
    expect(closestAspectRatioOption(1.7, OPTIONS)?.value).toBe('landscape');
    expect(closestAspectRatioOption(0.62, OPTIONS)?.value).toBe('portrait');
  });

  it('writes the provider-facing value when a visual preset is selected', () => {
    const onValueChange = vi.fn();
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="square"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '16:9' }));

    expect(onValueChange).toHaveBeenCalledWith('landscape');
    expect(screen.getByLabelText('Aspect ratio preview').getAttribute('data-ratio')).toBe('1');
  });

  it('matches the reference semantic preset layout and exposes ratio inputs', () => {
    render(
      <AspectRatioPicker
        options={REFERENCE_OPTIONS}
        value="square"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('Widescreen')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Landscape')).toBeTruthy();
    expect(screen.getByText('Square')).toBeTruthy();
    expect(screen.getByText('Portrait')).toBeTruthy();
    expect(screen.getByText('Tall')).toBeTruthy();
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' })).toBeTruthy();
  });

  it('only exposes semantic presets backed by the model capability list', () => {
    render(
      <AspectRatioPicker
        options={[
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
        ]}
        value="16:9"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Widescreen')).toBeTruthy();
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.queryByText('Auto')).toBeNull();
    expect(screen.queryByText('Square')).toBeNull();
    expect(screen.queryByText('Custom')).toBeNull();
  });

  it('honors model-specific extreme ratios from the ratio inputs', () => {
    const onValueChange = vi.fn();
    render(
      <AspectRatioPicker
        options={[
          { value: '4:1', label: '4:1' },
          { value: '8:1', label: '8:1' },
        ]}
        value="4:1"
        onValueChange={onValueChange}
      />,
    );

    const numerator = screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' });
    fireEvent.change(numerator, { target: { value: '8' } });
    fireEvent.blur(numerator);

    expect(onValueChange).toHaveBeenCalledWith('8:1');
  });

  it('snaps drag and keyboard changes to supported ratios', () => {
    const onValueChange = vi.fn();
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="square"
        onValueChange={onValueChange}
      />,
    );

    const handle = screen.getByRole('slider', { name: 'Adjust aspect ratio' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 180, clientY: 100 });

    expect(onValueChange).toHaveBeenCalledWith('landscape');
  });

  it('updates custom canvas dimensions without inventing an unsupported preset', () => {
    const onDimensionsChange = vi.fn();
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="square"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1080,
          height: 1080,
          onChange: onDimensionsChange,
        }}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Aspect ratio width' }), {
      target: { value: '1920' },
    });

    expect(onDimensionsChange).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });

  it('labels dimensions outside the preset list as custom', () => {
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="custom"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1440,
          height: 1920,
          onChange: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('button', { name: '16:9' }).getAttribute('aria-pressed')).toBe('false');
  });
});
