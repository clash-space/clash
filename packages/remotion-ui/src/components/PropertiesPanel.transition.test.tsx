// @vitest-environment jsdom
/**
 * Tests for the transition section of PropertiesPanel: when a TransitionItem
 * is selected, type / from-id / to-id controls are visible and editing them
 * dispatches UPDATE_ITEM into the editor reducer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { EditorProvider } from '@master-clash/remotion-core';
import type { EditorState, TransitionItem, VideoItem } from '@master-clash/remotion-core';
import { PropertiesPanel } from './PropertiesPanel';

afterEach(() => cleanup());

// Mocks: PropertiesPanel pulls in heavy deps for the no-selection / export
// branches. They're not exercised by these tests, but the imports execute.

// React-icons / Phosphor not actually used here, but defensive for any deps.

const makeVideo = (id: string, from: number, dur: number): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  from,
  durationInFrames: dur,
});

const makeTransition = (over: Partial<TransitionItem> = {}): TransitionItem => ({
  id: 'tx1',
  type: 'transition',
  from: 100,
  durationInFrames: 30,
  transitionType: 'push-left',
  fromItemId: 'clip-A',
  toItemId: 'clip-B',
  ...over,
});

const stateWithSelectedTransition = (
  txOver: Partial<TransitionItem> = {},
): Partial<EditorState> => ({
  tracks: [
    {
      id: 'video',
      name: 'Video',
      items: [makeVideo('clip-A', 0, 100), makeVideo('clip-B', 100, 100)],
    },
    {
      id: 'tx',
      name: 'Transitions',
      items: [makeTransition(txOver)],
    },
  ],
  selectedItemId: 'tx1',
});

describe('PropertiesPanel — transition section', () => {
  // Labels in PropertiesPanel are not htmlFor-associated, so we query by
  // placeholder/role and pull the type select via its display value.
  const getTypeSelect = () =>
    screen.getByRole('combobox') as HTMLSelectElement;
  const getFromInput = () =>
    screen.getByPlaceholderText('clip leaving') as HTMLInputElement;
  const getToInput = () =>
    screen.getByPlaceholderText('clip entering') as HTMLInputElement;

  it('shows the transition section when a transition item is selected', () => {
    render(
      <EditorProvider initialState={stateWithSelectedTransition()}>
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByText('Transition')).toBeTruthy();
    expect(getTypeSelect().value).toBe('push-left');
    expect(getFromInput().value).toBe('clip-A');
    expect(getToInput().value).toBe('clip-B');
  });

  it('lists all 9 transitionType options', () => {
    render(
      <EditorProvider initialState={stateWithSelectedTransition()}>
        <PropertiesPanel />
      </EditorProvider>,
    );
    const values = Array.from(getTypeSelect().options).map((o) => o.value);
    expect(values).toEqual([
      'crossfade',
      'push-left',
      'push-right',
      'slide-up',
      'slide-down',
      'wipe-left',
      'wipe-right',
      'circle-wipe',
      'zoom-in',
    ]);
  });

  it('changing the type dispatches UPDATE_ITEM and re-renders the new value', () => {
    const onChange = vi.fn();
    render(
      <EditorProvider
        initialState={stateWithSelectedTransition()}
        onStateChange={onChange}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );
    fireEvent.change(getTypeSelect(), { target: { value: 'circle-wipe' } });

    expect(getTypeSelect().value).toBe('circle-wipe');
    const lastCallState = onChange.mock.calls.at(-1)?.[0] as EditorState;
    const tx = lastCallState.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'tx1') as TransitionItem;
    expect(tx.transitionType).toBe('circle-wipe');
  });

  it('changing fromItemId / toItemId dispatches UPDATE_ITEM', () => {
    const onChange = vi.fn();
    render(
      <EditorProvider
        initialState={stateWithSelectedTransition()}
        onStateChange={onChange}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );
    fireEvent.change(getFromInput(), { target: { value: 'shot-1' } });
    fireEvent.change(getToInput(), { target: { value: 'shot-2' } });

    expect(getFromInput().value).toBe('shot-1');
    expect(getToInput().value).toBe('shot-2');

    const finalState = onChange.mock.calls.at(-1)?.[0] as EditorState;
    const tx = finalState.tracks.flatMap((t) => t.items).find((i) => i.id === 'tx1') as TransitionItem;
    expect(tx.fromItemId).toBe('shot-1');
    expect(tx.toItemId).toBe('shot-2');
  });

  it('does not show the transition section when a regular item is selected', () => {
    render(
      <EditorProvider
        initialState={{
          tracks: [
            {
              id: 'video',
              name: 'Video',
              items: [makeVideo('clip-A', 0, 100)],
            },
          ],
          selectedItemId: 'clip-A',
        }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );
    expect(screen.queryByText('Transition')).toBeNull();
    // But the Fades & Transitions section should be present (clip-A is a video)
    expect(screen.getByText('Fades & Transitions')).toBeTruthy();
  });
});
