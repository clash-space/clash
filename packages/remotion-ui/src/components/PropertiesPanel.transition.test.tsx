// @vitest-environment jsdom
/**
 * Tests for the transition section of PropertiesPanel: when a TransitionItem
 * is selected, its clip boundary stays structural while the user can resize
 * the centered transition range.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { EditorProvider } from '@clash/remotion-core';
import type { EditorState, TransitionItem, VideoItem } from '@clash/remotion-core';
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
  const getDurationInput = () =>
    screen.getByRole('spinbutton', { name: 'Transition duration in frames' }) as HTMLInputElement;

  it('shows the transition section when a transition item is selected', () => {
    render(
      <EditorProvider initialState={stateWithSelectedTransition()}>
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByText('Transition')).toBeTruthy();
    expect(getTypeSelect().value).toBe('push-left');
    expect(screen.getByText('clip-A')).toBeTruthy();
    expect(screen.getByText('clip-B')).toBeTruthy();
    expect(screen.queryByText('Transform')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull();
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
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const lastCallState = lastCall?.[0] as EditorState;
    const tx = lastCallState.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'tx1') as TransitionItem;
    expect(tx.transitionType).toBe('circle-wipe');
  });

  it('keeps the clip refs read-only and recenters a duration edit on the continuous boundary', () => {
    const onChange = vi.fn();
    render(
      <EditorProvider
        initialState={stateWithSelectedTransition()}
        onStateChange={onChange}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );
    expect(screen.queryByPlaceholderText('clip leaving')).toBeNull();
    expect(screen.queryByPlaceholderText('clip entering')).toBeNull();
    expect(getDurationInput().max).toBe('200');
    fireEvent.change(getDurationInput(), { target: { value: '40' } });

    const finalCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const finalState = finalCall?.[0] as EditorState;
    const tx = finalState.tracks.flatMap((t) => t.items).find((i) => i.id === 'tx1') as TransitionItem;
    expect(tx.fromItemId).toBe('clip-A');
    expect(tx.toItemId).toBe('clip-B');
    expect(tx.from).toBe(80);
    expect(tx.durationInFrames).toBe(40);
    expect(screen.getByText('00:02.66–00:04.00')).toBeTruthy();
  });

  it('clamps the duration to the two adjacent clip handles', () => {
    const onChange = vi.fn();
    render(
      <EditorProvider
        initialState={stateWithSelectedTransition()}
        onStateChange={onChange}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    fireEvent.change(getDurationInput(), { target: { value: '500' } });

    const finalCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const finalState = finalCall?.[0] as EditorState;
    const tx = finalState.tracks.flatMap((t) => t.items).find((i) => i.id === 'tx1') as TransitionItem;
    expect(tx.from).toBe(0);
    expect(tx.durationInFrames).toBe(200);
  });

  it('formats exact decimal frame boundaries without floating-point drift', () => {
    render(
      <EditorProvider
        initialState={stateWithSelectedTransition({
          from: 72,
          durationInFrames: 16,
        })}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByText('00:02.40–00:02.93')).toBeTruthy();
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
    // Video entrance/exit presentation is a clip animation, not an audio fade.
    expect(screen.getByText('Animation')).toBeTruthy();
    expect(screen.queryByText('Fades')).toBeNull();
  });
});
