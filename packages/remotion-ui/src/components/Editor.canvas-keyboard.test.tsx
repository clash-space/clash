// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EditorState } from '@clash/remotion-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';

vi.mock('./CanvasPreview', () => ({
  CanvasPreview: () => <div data-testid="canvas-media-item" />,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  window.currentDraggedItem = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Editor Canvas keyboard interaction', () => {
  it('moves focus out of Properties when the Canvas is pressed so Backspace removes the selection', async () => {
    let latestState: EditorState | null = null;
    render(
      <Editor
        layout="embedded"
        initialState={{
          selectedItemId: 'clip',
          primaryTrackId: 'primary',
          tracks: [
            {
              id: 'primary',
              name: 'Media',
              role: 'primary-video',
              category: 'primary',
              items: [
                {
                  id: 'clip',
                  type: 'video',
                  src: 'clip.mp4',
                  from: 0,
                  durationInFrames: 90,
                },
              ],
            },
          ],
        }}
        onStateChange={(state) => {
          latestState = state;
        }}
      />,
    );

    const startFrame = screen.getByRole('spinbutton', { name: 'Start frame' });
    startFrame.focus();
    expect(document.activeElement).toBe(startFrame);

    fireEvent.click(screen.getByTestId('canvas-media-item'));
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Backspace' });

    await waitFor(() => {
      expect(latestState?.tracks[0]?.items).toHaveLength(0);
    });
  });
});
