// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AspectRatioPicker, closestAspectRatioOption, parseAspectRatio } from './AspectRatioPicker';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    render(<AspectRatioPicker options={OPTIONS} value="square" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole('button', { name: '16:9' }));

    expect(onValueChange).toHaveBeenCalledWith('landscape');
    expect(screen.getByLabelText('Aspect ratio preview').getAttribute('data-ratio')).toBe('1');
  });

  it('hides the numeric editor while an automatic ratio sentinel is selected', () => {
    render(<AspectRatioPicker options={OPTIONS} value="auto" onValueChange={vi.fn()} />);

    expect(screen.queryByLabelText('Aspect ratio preview')).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Aspect ratio numerator' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Aspect ratio denominator' })).toBeNull();
  });

  it('renders the ratio controls directly at their settled visual state', () => {
    render(<AspectRatioPicker options={OPTIONS} value="square" onValueChange={vi.fn()} />);

    const editor = screen.getByLabelText('Aspect ratio').querySelector<HTMLElement>(
      '[data-aspect-ratio-editor]',
    );
    expect(editor).not.toBeNull();
    expect(editor!.style.opacity).toBe('');
    expect(editor!.style.transform).toBe('');
  });

  it('offers a drag target at every preview corner', () => {
    render(<AspectRatioPicker options={OPTIONS} value="square" onValueChange={vi.fn()} />);

    expect(screen.getAllByRole('slider')).toHaveLength(4);
  });

  it('emits a free ratio between presets when the capability allows custom values', () => {
    const onValueChange = vi.fn();
    render(<AspectRatioPicker allowCustom options={OPTIONS} value="square" onValueChange={onValueChange} />);

    const handle = screen.getByRole('slider', { name: 'Adjust aspect ratio' });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      buttons: 1,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 124.225,
      clientY: 100,
      buttons: 1,
    });

    expect(onValueChange).toHaveBeenCalledWith('7:5');
  });

  it('keeps wide custom ratios instead of clamping them to the preset range', () => {
    const onValueChange = vi.fn();
    render(<AspectRatioPicker allowCustom options={OPTIONS} value="square" onValueChange={onValueChange} />);

    const numerator = screen.getByRole('spinbutton', {
      name: 'Aspect ratio numerator',
    });
    const denominator = screen.getByRole('spinbutton', {
      name: 'Aspect ratio denominator',
    });
    fireEvent.change(numerator, { target: { value: '13' } });
    fireEvent.change(denominator, { target: { value: '2' } });
    fireEvent.blur(denominator);

    expect(onValueChange).toHaveBeenCalledWith('13:2');
  });

  it('shows plain ratios without semantic jargon or truncation', () => {
    render(<AspectRatioPicker options={REFERENCE_OPTIONS} value="square" onValueChange={vi.fn()} />);

    expect(screen.getByText('Auto')).toBeTruthy();
    const widescreen = screen.getByText('16:9');
    expect(widescreen.className).not.toContain('truncate');
    expect(screen.getByText('4:3')).toBeTruthy();
    expect(screen.getByText('3:2')).toBeTruthy();
    expect(screen.getByText('1:1')).toBeTruthy();
    expect(screen.getByText('3:4')).toBeTruthy();
    expect(screen.getByText('2:3')).toBeTruthy();
    expect(screen.getByText('9:16')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' })).toBeTruthy();
  });

  it('replaces provider aliases with canonical ratio labels', () => {
    render(
      <AspectRatioPicker
        options={[
          { value: 'landscape_16_9', label: 'Landscape (16:9)' },
          { value: 'landscape_4_3', label: 'Landscape (4:3)' },
          { value: 'square', label: 'Square (1:1)' },
          { value: 'portrait_3_4', label: 'Portrait (3:4)' },
          { value: 'portrait_9_16', label: 'Portrait (9:16)' },
          { value: 'ultrawide', label: 'Ultrawide (21:9)' },
          { value: 'custom', label: 'Custom' },
        ]}
        value="landscape_16_9"
        onValueChange={vi.fn()}
      />,
    );

    for (const ratio of ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) {
      expect(screen.getByRole('button', { name: ratio }).textContent).toBe(ratio);
    }
    expect(screen.queryByText(/Landscape|Square|Portrait|Ultrawide/)).toBeNull();
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

    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.getByText('9:16')).toBeTruthy();
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

    const numerator = screen.getByRole('spinbutton', {
      name: 'Aspect ratio numerator',
    });
    fireEvent.change(numerator, { target: { value: '8' } });
    fireEvent.blur(numerator);

    expect(onValueChange).toHaveBeenCalledWith('8:1');
  });

  it('snaps drag and keyboard changes to supported ratios', () => {
    const onValueChange = vi.fn();
    render(<AspectRatioPicker options={OPTIONS} value="square" onValueChange={onValueChange} />);

    const handle = screen.getByRole('slider', { name: 'Adjust aspect ratio' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      buttons: 1,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 180,
      clientY: 100,
      buttons: 1,
    });

    expect(onValueChange).toHaveBeenCalledWith('landscape');
  });

  it('updates custom canvas dimensions from a ratio without inventing an unsupported preset', () => {
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

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Aspect ratio numerator' }), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' }), {
      target: { value: '3' },
    });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Aspect ratio denominator' }));

    expect(onDimensionsChange).toHaveBeenCalledWith({
      width: 1440,
      height: 1080,
    });
  });

  it('commits a dragged canvas ratio once when the drag ends', () => {
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

    const handle = screen.getByRole('slider', { name: 'Adjust aspect ratio' });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      buttons: 1,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 124.225,
      clientY: 100,
      buttons: 1,
    });

    expect(onDimensionsChange).not.toHaveBeenCalled();
    expect(Number(screen.getByLabelText('Aspect ratio preview').getAttribute('data-ratio'))).toBeGreaterThan(1);

    fireEvent.pointerUp(handle, {
      pointerId: 1,
      clientX: 124.225,
      clientY: 100,
    });

    expect(onDimensionsChange).toHaveBeenCalledTimes(1);
    expect(onDimensionsChange.mock.calls[0]?.[0].width).toBeGreaterThan(1080);
    expect(onDimensionsChange.mock.calls[0]?.[0].height).toBe(1080);
  });

  it('does not highlight a nearby preset after a free canvas resize', () => {
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="custom"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1900,
          height: 1080,
          onChange: vi.fn(),
        }}
      />,
    );

    const handle = screen.getByRole('slider', { name: 'Adjust aspect ratio' });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      buttons: 1,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 101,
      clientY: 100,
      buttons: 1,
    });

    expect(screen.getByRole('button', { name: '16:9' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('does not highlight any preset for an unmatched initial ratio', () => {
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="custom"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1417,
          height: 1440,
          onChange: vi.fn(),
        }}
      />,
    );

    const presetButtons = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
    expect(presetButtons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('synthesizes a visibly labeled Custom preset for an editable Canvas', () => {
    const onDimensionsChange = vi.fn();
    const { rerender } = render(
      <AspectRatioPicker
        density="compact"
        options={OPTIONS}
        value="custom"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1080,
          height: 1440,
          onChange: onDimensionsChange,
        }}
      />,
    );

    const custom = screen.getByRole('button', { name: 'Custom' });
    expect(custom.textContent).toBe('Custom');
    expect(custom.lastElementChild?.className).toContain('hidden');

    rerender(
      <AspectRatioPicker
        density="compact"
        options={OPTIONS}
        value="custom"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1920,
          height: 1080,
          onChange: onDimensionsChange,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Custom' }).textContent).toBe('Custom');
  });

  it('keeps the editor inside a narrow host container with an intrinsic grid', () => {
    render(
      <AspectRatioPicker
        options={OPTIONS}
        value="square"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1920,
          height: 1080,
          onChange: vi.fn(),
        }}
      />,
    );

    const picker = screen.getByLabelText('Aspect ratio');
    const content = picker.querySelector('[data-aspect-ratio-content]');
    const editor = picker.querySelector('[data-aspect-ratio-editor]');

    expect(content).not.toBeNull();
    expect(editor).not.toBeNull();
    expect(content!.className).toContain('repeat(auto-fit');
    expect(content!.className).toContain('min(100%');
    expect(editor!.className).toContain('min-w-0');
    expect(editor!.className).toContain('w-full');
  });

  it('uses workbench-sized controls in compact density', () => {
    render(
      <AspectRatioPicker
        density="compact"
        options={OPTIONS}
        value="square"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1920,
          height: 1080,
          onChange: vi.fn(),
        }}
      />,
    );

    const picker = screen.getByLabelText('Aspect ratio');
    const preview = screen.getByLabelText('Aspect ratio preview');
    const widthInput = screen.getByRole('spinbutton', {
      name: 'Aspect ratio numerator',
    });
    const selectedPreset = screen.getByRole('button', { name: '1:1' });
    const selectedPresetLabel = selectedPreset.lastElementChild as HTMLElement;

    expect(picker.getAttribute('data-aspect-ratio-density')).toBe('compact');
    expect(preview.className).not.toContain('h-36');
    expect(widthInput.className).toContain('h-8');
    expect(widthInput.className).toContain('[&::-webkit-inner-spin-button]:appearance-none');
    expect(selectedPreset.className).toContain('w-7');
    expect(selectedPreset.className).toContain('justify-self-start');
    expect(selectedPresetLabel.className).toContain('hidden');
  });

  it('reveals compact preset hints when the picker has room and hides them when it shrinks', async () => {
    let reportWidth: ((width: number) => void) | undefined;

    class TestResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        if (!(target instanceof HTMLElement) || !target.hasAttribute('data-aspect-ratio-density')) return;
        reportWidth = (width) => {
          this.callback([
            { contentRect: { width } } as ResizeObserverEntry,
          ], this as unknown as ResizeObserver);
        };
      }
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    render(
      <AspectRatioPicker
        density="compact"
        options={OPTIONS}
        value="square"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1920,
          height: 1080,
          onChange: vi.fn(),
        }}
      />,
    );

    const picker = screen.getByLabelText('Aspect ratio');
    const preset = screen.getByRole('button', { name: '1:1' });
    const label = preset.lastElementChild as HTMLElement;

    expect(picker.getAttribute('data-compact-preset-hints')).toBe('hidden');
    expect(reportWidth).toBeTypeOf('function');

    await act(async () => reportWidth?.(320));

    await waitFor(() => expect(picker.getAttribute('data-compact-preset-hints')).toBe('visible'));
    expect(preset.className).toContain('w-full');
    expect(label.className).not.toContain('hidden');

    await act(async () => reportWidth?.(180));

    await waitFor(() => expect(picker.getAttribute('data-compact-preset-hints')).toBe('hidden'));
    expect(label.className).toContain('hidden');
  });

  it('shows a plain-ratio hint for compact icon presets', async () => {
    render(
      <AspectRatioPicker
        density="compact"
        options={REFERENCE_OPTIONS}
        value="square"
        onValueChange={vi.fn()}
      />,
    );

    const widescreen = screen.getByRole('button', { name: '16:9' });
    fireEvent.mouseEnter(widescreen);
    fireEvent.mouseMove(widescreen, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(widescreen, { clientX: 12, clientY: 10 });

    expect((await screen.findByRole('tooltip')).textContent).toBe('16:9');
  });

  it('keeps compact ratio inputs in one readable row', () => {
    render(
      <AspectRatioPicker
        density="compact"
        options={OPTIONS}
        value="square"
        onValueChange={vi.fn()}
        customDimensions={{
          width: 1920,
          height: 1080,
          onChange: vi.fn(),
        }}
      />,
    );

    const picker = screen.getByLabelText('Aspect ratio');
    const content = picker.querySelector('[data-aspect-ratio-content]');
    const editor = picker.querySelector('[data-aspect-ratio-editor]');
    const dimensions = picker.querySelector('[data-aspect-ratio-dimensions]');

    expect(content?.className).toContain('@min-[24rem]:grid-cols-[minmax(0,1fr)_10rem]');
    expect(editor?.className).toContain('@min-[24rem]:max-w-40');
    expect(dimensions).not.toBeNull();
    expect(dimensions!.className).toContain('flex-row');
    expect(dimensions!.className).not.toContain('flex-col');
    expect(dimensions!.className).not.toContain('grid-cols');
    expect(dimensions!.children[1]?.className).not.toContain('hidden');
  });

  it('leaves every real preset unselected for dimensions outside the list', () => {
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

    expect(screen.getByRole('button', { name: 'Custom' }).textContent).toBe('Custom');
    expect(screen.getByRole('button', { name: '16:9' }).getAttribute('aria-pressed')).toBe('false');
  });
});
