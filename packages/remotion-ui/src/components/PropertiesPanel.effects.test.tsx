// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, type EditorState, type ImageItem } from '@master-clash/remotion-core';
import { PropertiesPanel } from './PropertiesPanel';

afterEach(() => cleanup());

const image: ImageItem = {
  id: 'image',
  type: 'image',
  src: 'image.png',
  from: 0,
  durationInFrames: 90,
  effects: [{
    effectId: 'clash/camera-shake',
    effectVersion: 1,
    params: { intensity: 6, speed: 2.2 },
  }, {
    effectId: 'clash/monochrome',
    effectVersion: 1,
  }],
};

const initialState: Partial<EditorState> = {
  tracks: [{ id: 'primary', name: 'Media', role: 'primary-video', category: 'primary', items: [image] }],
  primaryTrackId: 'primary',
  selectedItemId: image.id,
};

describe('PropertiesPanel effect stack', () => {
  it('edits registry-backed effect parameters and removes an effect instance', () => {
    const stateRef = { current: null as EditorState | null };
    render(
      <EditorProvider initialState={initialState} onStateChange={(state) => { stateRef.current = state; }}>
        <PropertiesPanel />
      </EditorProvider>,
    );

    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.getByText('Camera Shake')).toBeTruthy();
    expect(screen.getByText('Monochrome')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Camera Shake intensity'), { target: { value: '9' } });
    expect(stateRef.current!.tracks[0].items[0].effects?.[0].params?.intensity).toBe(9);

    fireEvent.click(screen.getByLabelText('Move Monochrome up'));
    expect(stateRef.current!.tracks[0].items[0].effects?.map((effect) => effect.effectId))
      .toEqual(['clash/monochrome', 'clash/camera-shake']);

    fireEvent.click(screen.getByLabelText('Remove Camera Shake'));
    expect(stateRef.current!.tracks[0].items[0].effects?.map((effect) => effect.effectId))
      .toEqual(['clash/monochrome']);
  });
});
