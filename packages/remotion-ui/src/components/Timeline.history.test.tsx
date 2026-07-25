// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  EditorProvider,
  useEditorDispatch,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const HistoryProbe = () => {
  const dispatch = useEditorDispatch();
  const { tracks } = useEditorStaticState();
  return (
    <>
      <button
        type="button"
        onClick={() => dispatch({
          type: 'UPDATE_ITEM',
          payload: { trackId: 'primary', itemId: 'clip', updates: { from: 45 } },
        })}
      >
        Move clip
      </button>
      <output aria-label="Clip start">{tracks[0].items[0].from}</output>
    </>
  );
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  window.currentDraggedItem = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Timeline history controls', () => {
  it('connects toolbar buttons and keyboard shortcuts to the same history', async () => {
    render(
      <EditorProvider
        initialState={{
          tracks: [{
            id: 'primary',
            name: 'Media',
            role: 'primary-video',
            category: 'primary',
            items: [{
              id: 'clip',
              type: 'video',
              src: 'clip.mp4',
              from: 0,
              durationInFrames: 90,
            }],
          }],
          primaryTrackId: 'primary',
        }}
      >
        <Timeline />
        <HistoryProbe />
      </EditorProvider>,
    );

    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move clip' }));
    await waitFor(() => expect(screen.getByLabelText('Clip start').textContent).toBe('45'));
    expect(undo.disabled).toBe(false);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText('Clip start').textContent).toBe('0'));
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    await waitFor(() => expect(screen.getByLabelText('Clip start').textContent).toBe('45'));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText('Clip start').textContent).toBe('45'));
  });
});
