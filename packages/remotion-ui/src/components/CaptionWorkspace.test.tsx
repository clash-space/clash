// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EditorProvider,
  useEditor,
  type EditorAssetTranscript,
  type EditorState,
} from '@clash/remotion-core';
import { CaptionWorkspace } from './CaptionWorkspace';

const StateProbe = ({ onState }: { onState: (state: EditorState) => void }) => {
  const { state } = useEditor();
  onState(state);
  return null;
};

afterEach(() => cleanup());

describe('CaptionWorkspace', () => {
  it('keeps recognition, caption text editing, file import, and styles together', () => {
    const { container } = render(
      <EditorProvider>
        <CaptionWorkspace />
      </EditorProvider>,
    );

    const workspaceTabs = container.querySelector('[data-caption-workspace-tabs]');
    expect(workspaceTabs?.className).toContain('overflow-x-auto');
    expect(screen.getByRole('tab', { name: 'Recognize' }).className).toContain('shrink-0');
    expect(screen.getByRole('tab', { name: 'Recognize' }).className).toContain('whitespace-nowrap');
    expect(screen.getByRole('tab', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Styles' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Replace existing captions' }) as HTMLInputElement).checked).toBe(false);
  });

  it('keeps the styles catalog embedded in a single panel surface', () => {
    const { container } = render(
      <EditorProvider>
        <CaptionWorkspace initialView="styles" />
      </EditorProvider>,
    );

    const workspace = container.querySelector('[data-editor-caption-workspace]');
    expect(workspace?.className).toContain('clash-timeline-panel-surface');
    expect(workspace?.className).not.toContain('rounded-matrix');
    expect(workspace?.querySelectorAll('.clash-timeline-panel-surface')).toHaveLength(0);
    expect(container.querySelector('[data-timeline-library-panel]')?.getAttribute('data-embedded')).toBe('true');
  });

  it('turns a real asset transcript into a structured caption item', async () => {
    let latest: EditorState | null = null;
    const transcript: EditorAssetTranscript = {
      schemaVersion: 1,
      kind: 'clash.editor.asset-transcript',
      assetId: 'speech',
      text: 'Hello world',
      durationMs: 1000,
      words: [
        { id: 'hello', text: 'Hello', startMs: 0, endMs: 450 },
        { id: 'world', text: 'world', startMs: 500, endMs: 1000 },
      ],
    };
    const onTranscribeAsset = vi.fn(async () => transcript);

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 90,
          assets: [{ id: 'speech', name: 'speech.mp4', type: 'video', src: 'speech.mp4', createdAt: 1 }],
          tracks: [{
            id: 'primary',
            name: 'Media',
            role: 'primary-video',
            category: 'primary',
            items: [{
              id: 'clip',
              type: 'video',
              assetId: 'speech',
              src: 'speech.mp4',
              from: 0,
              durationInFrames: 30,
            }],
          }],
          primaryTrackId: 'primary',
        }}
      >
        <CaptionWorkspace onTranscribeAsset={onTranscribeAsset} />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recognize captions' }));

    await waitFor(() => {
      expect(latest!.tracks.flatMap((track) => track.items)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Hello world',
          cues: [expect.objectContaining({ text: 'Hello world' })],
        }),
      ]));
    });
    expect(latest!.tracks.find((track) => track.role === 'subtitle')).toMatchObject({
      name: 'Text',
      role: 'subtitle',
      category: 'text',
    });
    expect(onTranscribeAsset).toHaveBeenCalledTimes(1);
  });

  it('recognizes only the spoken lane in a full mix with music and sound design', async () => {
    const onTranscribeAsset = vi.fn(async (asset: { id: string }) => ({
      schemaVersion: 1 as const,
      kind: 'clash.editor.asset-transcript' as const,
      assetId: asset.id,
      text: 'Spoken line',
      durationMs: 1000,
      words: [{ id: 'spoken', text: 'Spoken line', startMs: 0, endMs: 1000 }],
    }));

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 60,
          assets: [
            { id: 'voice', name: 'voice.wav', type: 'audio', src: 'voice.wav', createdAt: 1 },
            { id: 'music', name: 'music.wav', type: 'audio', src: 'music.wav', createdAt: 2 },
            { id: 'whoosh', name: 'whoosh.wav', type: 'audio', src: 'whoosh.wav', createdAt: 3 },
          ],
          tracks: [
            {
              id: 'voice-track',
              name: 'Voiceover',
              role: 'narration',
              category: 'audio',
              items: [{ id: 'voice-item', type: 'audio', assetId: 'voice', src: 'voice.wav', from: 0, durationInFrames: 30 }],
            },
            {
              id: 'music-track',
              name: 'Music',
              role: 'music',
              category: 'audio',
              items: [{ id: 'music-item', type: 'audio', assetId: 'music', src: 'music.wav', from: 0, durationInFrames: 30 }],
            },
            {
              id: 'sfx-track',
              name: 'Sound Design',
              role: 'sfx',
              category: 'audio',
              items: [{ id: 'sfx-item', type: 'audio', assetId: 'whoosh', src: 'whoosh.wav', from: 0, durationInFrames: 30 }],
            },
          ],
        }}
      >
        <CaptionWorkspace onTranscribeAsset={onTranscribeAsset} />
      </EditorProvider>,
    );

    expect(screen.getByText('1 spoken-media asset')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recognize captions' }));
    await waitFor(() => expect(onTranscribeAsset).toHaveBeenCalledTimes(1));
    expect(onTranscribeAsset.mock.calls[0]?.[0]).toMatchObject({ id: 'voice' });
  });

  it('edits caption text without changing the source media', () => {
    let latest: EditorState | null = null;
    render(
      <EditorProvider
        initialState={{
          tracks: [{
            id: 'captions',
            name: 'Captions',
            role: 'subtitle',
            category: 'text',
            items: [{
              id: 'caption',
              type: 'text',
              text: 'Old text',
              color: '#ffffff',
              from: 0,
              durationInFrames: 60,
              cues: [{ id: 'cue', startFrame: 0, durationInFrames: 30, text: 'Old text' }],
            }],
          }],
        }}
      >
        <CaptionWorkspace initialView="edit" />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    fireEvent.change(screen.getByLabelText('Caption sentence 1 text'), {
      target: { value: 'Corrected text' },
    });

    const caption = latest!.tracks[0].items[0];
    expect(caption).toMatchObject({
      type: 'text',
      text: 'Corrected text',
      cues: [expect.objectContaining({ text: 'Corrected text' })],
    });
  });

  it('replaces an existing subtitle Text item without deleting its lane', async () => {
    let latest: EditorState | null = null;
    const onTranscribeAsset = vi.fn(async () => ({
      schemaVersion: 1 as const,
      kind: 'clash.editor.asset-transcript' as const,
      assetId: 'voice',
      text: 'Replacement',
      durationMs: 1000,
      words: [{ id: 'replacement', text: 'Replacement', startMs: 0, endMs: 1000 }],
    }));
    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 60,
          assets: [{ id: 'voice', name: 'voice.wav', type: 'audio', src: 'voice.wav', createdAt: 1 }],
          tracks: [
            {
              id: 'text-track',
              name: 'Text',
              role: 'subtitle',
              category: 'text',
              items: [{
                id: 'old-text',
                type: 'text',
                text: 'Old',
                color: '#fff',
                from: 0,
                durationInFrames: 60,
                cues: [{ id: 'old-cue', startFrame: 0, durationInFrames: 30, text: 'Old' }],
              }],
            },
            {
              id: 'voice-track',
              name: 'Voiceover',
              role: 'narration',
              category: 'audio',
              items: [{ id: 'voice-item', type: 'audio', assetId: 'voice', src: 'voice.wav', from: 0, durationInFrames: 30 }],
            },
          ],
        }}
      >
        <CaptionWorkspace onTranscribeAsset={onTranscribeAsset} />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Replace existing captions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recognize captions' }));

    await waitFor(() => {
      const textTrack = latest!.tracks.find((track) => track.role === 'subtitle');
      expect(textTrack).toMatchObject({ id: 'text-track', name: 'Text', category: 'text' });
      expect(textTrack?.items).toHaveLength(1);
      expect(textTrack?.items[0]).toMatchObject({ type: 'text', text: 'Replacement' });
    });
  });

  it('offers manual Timeline editing from transcript words without an automatic filler-removal action', async () => {
    let latest: EditorState | null = null;
    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 90,
          primaryTrackId: 'primary',
          tracks: [{
            id: 'primary',
            name: 'Media',
            role: 'primary-video',
            category: 'primary',
            items: [{
              id: 'clip',
              type: 'video',
              assetId: 'speech',
              src: 'speech.mp4',
              from: 0,
              durationInFrames: 90,
            }],
          }],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: 'clash.editor.asset-transcript',
              assetId: 'speech',
              text: '大家 嗯 现在',
              durationMs: 1500,
              words: [
                { id: 'start', text: '大家', startMs: 0, endMs: 500 },
                { id: 'manual-cut', text: '嗯', startMs: 500, endMs: 1000 },
                { id: 'end', text: '现在', startMs: 1000, endMs: 1500 },
              ],
            },
          },
        }}
      >
        <CaptionWorkspace initialView="edit" />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    expect(screen.getByRole('tab', { name: 'Caption text' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline edit' }));
    expect(screen.getByTestId('timeline-transcript-editor')).toBeTruthy();
    expect(screen.queryByText(/remove filler|clean filler|剪水词/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '嗯' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected transcript words' }));

    await waitFor(() => {
      expect(latest!.tracks[0].items).toMatchObject([
        { id: 'clip', from: 0, durationInFrames: 15 },
        { from: 15, durationInFrames: 60, sourceStartInFrames: 30 },
      ]);
    });
  });

  it('reports when Timeline edit should become the primary document workspace', () => {
    const onTimelineEditModeChange = vi.fn();
    render(
      <EditorProvider>
        <CaptionWorkspace
          initialView="edit"
          onTimelineEditModeChange={onTimelineEditModeChange}
        />
      </EditorProvider>,
    );

    expect(onTimelineEditModeChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline edit' }));
    expect(onTimelineEditModeChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Caption text' }));
    expect(onTimelineEditModeChange).toHaveBeenLastCalledWith(false);
  });

  it('imports a subtitle file into the caption lane', async () => {
    let latest: EditorState | null = null;
    const file = new File([], 'captions.srt', { type: 'application/x-subrip' });
    Object.defineProperty(file, 'text', {
      value: async () => '1\n00:00:00,000 --> 00:00:01,000\nImported line',
    });
    render(
      <EditorProvider initialState={{ fps: 30, durationInFrames: 60 }}>
        <CaptionWorkspace initialView="import" />
        <StateProbe onState={(state) => { latest = state; }} />
      </EditorProvider>,
    );

    fireEvent.change(screen.getByLabelText('Import subtitle file'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(latest!.tracks.flatMap((track) => track.items)).toEqual([
        expect.objectContaining({
          type: 'text',
          text: 'Imported line',
          cues: [expect.objectContaining({ text: 'Imported line' })],
        }),
      ]);
    });
    expect(latest!.tracks[0]).toMatchObject({
      name: 'Text',
      role: 'subtitle',
      category: 'text',
    });
  });
});
