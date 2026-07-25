// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EditorProvider,
  type AudioItem,
  type EditorState,
} from '@master-clash/remotion-core';
import { PropertiesPanel } from './PropertiesPanel';

afterEach(() => cleanup());

const audio: AudioItem = {
  id: 'voice',
  type: 'audio',
  src: 'voice.wav',
  from: 0,
  durationInFrames: 90,
  volume: 0.5,
  audioFadeIn: 12,
  audioFadeOut: 18,
};

const initialState: Partial<EditorState> = {
  tracks: [{
    id: 'voice',
    name: 'Voiceover',
    role: 'narration',
    category: 'audio',
    items: [audio],
  }],
  selectedItemId: audio.id,
};

describe('PropertiesPanel audio fields', () => {
  it('reads legacy audio fields but writes the self-describing DSL fields', () => {
    const stateRef = { current: null as EditorState | null };
    render(
      <EditorProvider
        initialState={initialState}
        onStateChange={(state) => { stateRef.current = state; }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    const gain = screen.getByRole('spinbutton', { name: 'Audio gain in decibels' });
    const fadeIn = screen.getByRole('spinbutton', { name: 'Audio fade in frames' });
    const fadeOut = screen.getByRole('spinbutton', { name: 'Audio fade out frames' });
    expect((gain as HTMLInputElement).value).toBe('-6');
    expect((fadeIn as HTMLInputElement).value).toBe('12');
    expect((fadeOut as HTMLInputElement).value).toBe('18');

    fireEvent.change(gain, { target: { value: '8.6' } });
    fireEvent.change(fadeIn, { target: { value: '15' } });
    fireEvent.change(fadeOut, { target: { value: '20' } });

    const updated = stateRef.current!.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === audio.id) as AudioItem;
    expect(updated.audioGainDb).toBe(8.6);
    expect(updated.audioFadeInFrames).toBe(15);
    expect(updated.audioFadeOutFrames).toBe(20);
    expect(updated.volume).toBeUndefined();
    expect(updated.audioFadeIn).toBeUndefined();
    expect(updated.audioFadeOut).toBeUndefined();
  });

  it('persists ducking controls on music clips and removes them when disabled', () => {
    const music: AudioItem = {
      id: 'music',
      type: 'audio',
      src: 'music.wav',
      from: 0,
      durationInFrames: 180,
      audioGainDb: 0,
    };
    const stateRef = { current: null as EditorState | null };
    render(
      <EditorProvider
        initialState={{
          tracks: [{
            id: 'music',
            name: 'Music',
            role: 'music',
            category: 'audio',
            items: [music],
          }],
          selectedItemId: music.id,
        }}
        onStateChange={(state) => { stateRef.current = state; }}
      >
        <PropertiesPanel />
      </EditorProvider>,
    );

    const enabled = screen.getByRole('checkbox', { name: 'Automatic audio ducking' });
    fireEvent.click(enabled);

    const amount = screen.getByRole('spinbutton', { name: 'Ducking amount in decibels' });
    const attack = screen.getByRole('spinbutton', { name: 'Ducking attack frames' });
    const release = screen.getByRole('spinbutton', { name: 'Ducking release frames' });
    expect((amount as HTMLInputElement).value).toBe('-18');
    expect((attack as HTMLInputElement).value).toBe('6');
    expect((release as HTMLInputElement).value).toBe('12');

    fireEvent.change(amount, { target: { value: '-24' } });
    fireEvent.change(attack, { target: { value: '8' } });
    fireEvent.change(release, { target: { value: '16' } });

    let updated = stateRef.current!.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === music.id) as AudioItem;
    expect(updated.audioDucking).toEqual({
      amountDb: -24,
      attackFrames: 8,
      releaseFrames: 16,
    });

    fireEvent.click(enabled);
    updated = stateRef.current!.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === music.id) as AudioItem;
    expect(updated.audioDucking).toBeUndefined();
  });
});
