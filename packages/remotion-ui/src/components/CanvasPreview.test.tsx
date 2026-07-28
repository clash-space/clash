// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  EditorProvider,
  useEditorHistory,
  useEditorPlayback,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasPreview } from './CanvasPreview';
import {
  createPreviewAudioMeterStore,
  type PreviewAudioMeterStore,
} from './previewAudioMeter';

vi.mock('./InteractiveCanvasV2', () => ({
  InteractiveCanvas: (props: {
    viewportCommand?: { type: string; zoom?: number };
    audioMeterEnabled?: boolean;
    onTransformStart?: () => void;
    onTransformEnd?: () => void;
    onUpdateItem?: (trackId: string, itemId: string, updates: unknown) => void;
  }) => (
    <>
      <div
        data-testid="interactive-canvas"
        data-viewport-command={props.viewportCommand
          ? `${props.viewportCommand.type}:${props.viewportCommand.zoom ?? ''}`
          : ''}
        data-audio-meter-enabled={props.audioMeterEnabled}
      />
      <button
        type="button"
        aria-label="Simulate canvas drag"
        onClick={() => {
          props.onTransformStart?.();
          props.onUpdateItem?.('visual', 'clip', {
            properties: { x: 10, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 },
          });
          props.onUpdateItem?.('visual', 'clip', {
            properties: { x: 20, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 },
          });
          props.onTransformEnd?.();
        }}
      >
        Simulate canvas drag
      </button>
    </>
  ),
}));

const PlaybackProbe = () => {
  const playback = useEditorPlayback();
  return <output aria-label="Playback state">{`${playback.currentFrame}:${playback.playing}`}</output>;
};

const HistoryProbe = () => {
  const { canUndo, undo } = useEditorHistory();
  const { tracks } = useEditorStaticState();
  const clip = tracks.flatMap((track) => track.items).find((item) => item.id === 'clip');
  return (
    <>
      <output aria-label="Canvas item x">{clip?.properties?.x ?? 0}</output>
      <button type="button" aria-label="Undo canvas edit" disabled={!canUndo} onClick={undo}>
        Undo
      </button>
    </>
  );
};

function renderPreview(props: {
  audioMeterOpen?: boolean;
  onToggleAudioMeter?: () => void;
  audioMeterStore?: PreviewAudioMeterStore;
} = {}) {
  return render(
    <EditorProvider
      initialState={{
        fps: 30,
        currentFrame: 0,
        playing: false,
        compositionWidth: 1920,
        compositionHeight: 1080,
        tracks: [
          {
            id: 'visual',
            name: 'Visual',
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
      <CanvasPreview {...props} />
      <PlaybackProbe />
      <HistoryProbe />
    </EditorProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CanvasPreview transport', () => {
  it('owns frame-accurate time and playback without a progress bar', async () => {
    renderPreview();

    expect(screen.getByLabelText('Current timecode').textContent).toBe('00:00:00:00');
    expect(screen.getByLabelText('Duration timecode').textContent).toBe('00:00:03:00');
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Preview position' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(screen.getByLabelText('Playback state').textContent).toBe('0:true'));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

  });

  it('groups a continuous Canvas transform into one Undo step', async () => {
    renderPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate canvas drag' }));
    await waitFor(() => expect(screen.getByLabelText('Canvas item x').textContent).toBe('20'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo canvas edit' }));
    await waitFor(() => expect(screen.getByLabelText('Canvas item x').textContent).toBe('0'));
    expect(screen.getByRole('button', { name: 'Undo canvas edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('opens a real canvas zoom regulator from the viewport icon', () => {
    renderPreview();

    expect(screen.queryByRole('dialog', { name: 'Canvas zoom controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas zoom' }));

    expect(screen.getByRole('dialog', { name: 'Canvas zoom controls' })).toBeTruthy();
    const zoom = screen.getByRole('slider', { name: 'Canvas zoom level' }) as HTMLInputElement;
    expect(zoom.value).toBe('100');

    fireEvent.change(zoom, { target: { value: '150' } });
    expect(screen.getByTestId('interactive-canvas').getAttribute('data-viewport-command')).toBe('set-zoom:1.5');

    fireEvent.click(screen.getByRole('button', { name: 'Fit canvas' }));
    expect(screen.getByTestId('interactive-canvas').getAttribute('data-viewport-command')).toBe('reset:');
  });

  it('toggles a read-only live audio meter instead of changing volume', () => {
    const onToggleAudioMeter = vi.fn();
    const { rerender } = renderPreview({ audioMeterOpen: false, onToggleAudioMeter });

    expect(screen.queryByRole('slider', { name: /Preview volume/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mute preview/i })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Audio level meter' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('interactive-canvas').getAttribute('data-audio-meter-enabled')).toBe('false');

    fireEvent.click(toggle);
    expect(onToggleAudioMeter).toHaveBeenCalledOnce();

    rerender(
      <EditorProvider
        initialState={{
          fps: 30,
          currentFrame: 0,
          playing: false,
          compositionWidth: 1920,
          compositionHeight: 1080,
          tracks: [],
        }}
      >
        <CanvasPreview audioMeterOpen onToggleAudioMeter={onToggleAudioMeter} />
        <PlaybackProbe />
      </EditorProvider>,
    );
    expect(screen.getByRole('button', { name: 'Audio level meter' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('interactive-canvas').getAttribute('data-audio-meter-enabled')).toBe('true');
  });

  it('represents the live meter as paired left and right channel columns', () => {
    renderPreview();

    const toggle = screen.getByRole('button', { name: 'Audio level meter' });
    const channels = Array.from(
      toggle.querySelectorAll<SVGGElement>('[data-audio-meter-channel]'),
    ).map((channel) => channel.getAttribute('data-audio-meter-channel'));

    expect(channels).toEqual(['L', 'R']);
    expect(toggle.querySelector('[data-stereo-meter-icon]')).toBeTruthy();
  });

  it('keeps the compact L/R meter live while the full meter is closed', () => {
    const audioMeterStore = createPreviewAudioMeterStore();
    renderPreview({ audioMeterOpen: false, audioMeterStore });

    expect(screen.getByTestId('interactive-canvas').getAttribute('data-audio-meter-enabled')).toBe('true');
    const toggle = screen.getByRole('button', { name: 'Audio level meter' });
    const leftFill = toggle.querySelector<SVGRectElement>('[data-audio-meter-fill="L"]');
    const rightFill = toggle.querySelector<SVGRectElement>('[data-audio-meter-fill="R"]');
    expect(leftFill?.getAttribute('height')).toBe('0');
    expect(rightFill?.getAttribute('height')).toBe('0');
    expect(leftFill?.getAttribute('fill')).toBe('var(--clash-accent, #ff6b50)');
    expect(rightFill?.getAttribute('fill')).toBe('var(--clash-accent, #ff6b50)');

    act(() => audioMeterStore.setLevels({ left: 0.5, right: 0.25 }));

    expect(Number(leftFill?.getAttribute('height'))).toBeGreaterThan(
      Number(rightFill?.getAttribute('height')),
    );
    expect(Number(rightFill?.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('hides secondary transport labels when the Preview reaches its minimum width', () => {
    const packageRoot = process.cwd().endsWith('packages/remotion-ui')
      ? process.cwd()
      : resolve(process.cwd(), 'packages/remotion-ui');
    const source = readFileSync(
      resolve(packageRoot, 'src/components/CanvasPreview.tsx'),
      'utf8',
    );

    expect(source).toContain('display: none !important;');
  });

  it('uses the panel surface around the video and exposes native fullscreen', () => {
    const { container } = renderPreview();
    const root = screen.getByTestId('canvas-preview');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(root, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    expect(root.getAttribute('data-surface')).toBe('warm-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-preview-stage]')).toBeTruthy();
  });
});
