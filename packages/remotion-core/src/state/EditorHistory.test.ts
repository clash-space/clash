import { describe, expect, it } from 'vitest';
import type { EditorState, Track, VideoItem } from '../types';
import {
  createEditorHistoryState,
  editorHistoryReducer,
  editorInitialState,
} from './EditorContext';

const makeVideo = (id: string, from: number): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  from,
  durationInFrames: 30,
});

const makeState = (): EditorState => ({
  ...editorInitialState,
  tracks: [{
    id: 'primary',
    name: 'Media',
    role: 'primary-video',
    category: 'primary',
    items: [makeVideo('clip', 0)],
  }],
  primaryTrackId: 'primary',
});

describe('Timeline editor history', () => {
  it('fails closed when an editor action has no reducer executor', () => {
    const initial = createEditorHistoryState(makeState());

    expect(() => editorHistoryReducer(
      initial,
      { type: 'FUTURE_UNHANDLED_ACTION' } as never,
    )).toThrow(/Unhandled Timeline editor action/);
  });

  it('undoes and redoes a Timeline document edit', () => {
    const initial = createEditorHistoryState(makeState());
    const edited = editorHistoryReducer(initial, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { from: 45 } },
    });

    expect(edited.present.tracks[0].items[0].from).toBe(45);
    expect(edited.past).toHaveLength(1);
    expect(edited.future).toHaveLength(0);

    const undone = editorHistoryReducer(edited, { type: 'UNDO' });
    expect(undone.present.tracks[0].items[0].from).toBe(0);
    expect(undone.past).toHaveLength(0);
    expect(undone.future).toHaveLength(1);

    const redone = editorHistoryReducer(undone, { type: 'REDO' });
    expect(redone.present.tracks[0].items[0].from).toBe(45);
    expect(redone.past).toHaveLength(1);
    expect(redone.future).toHaveLength(0);
  });

  it('undoes and redoes clip-local mask keyframes with the item edit', () => {
    const initial = createEditorHistoryState(makeState());
    const mask = {
      shape: 'ellipse' as const,
      position: [50, 50] as const,
      size: [70, 70] as const,
      rotation: 0,
      feather: 0,
      inverted: false,
    };
    const keyframes = {
      maskPosition: [
        { frame: 0, value: [50, 50] as const, interpolation: 'linear' as const },
        { frame: 20, value: [75, 50] as const, interpolation: 'linear' as const },
      ],
    };
    const edited = editorHistoryReducer(initial, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { mask, keyframes } },
    });

    expect(edited.present.tracks[0].items[0]).toMatchObject({ mask, keyframes });
    const undone = editorHistoryReducer(edited, { type: 'UNDO' });
    expect(undone.present.tracks[0].items[0].mask).toBeUndefined();
    expect(undone.present.tracks[0].items[0].keyframes).toBeUndefined();
    const redone = editorHistoryReducer(undone, { type: 'REDO' });
    expect(redone.present.tracks[0].items[0]).toMatchObject({ mask, keyframes });
  });

  it('does not record playback, selection, or zoom as Timeline edits', () => {
    const initial = createEditorHistoryState(makeState());
    const actions = [
      { type: 'SET_PLAYING', payload: true },
      { type: 'SET_CURRENT_FRAME', payload: 12 },
      { type: 'SELECT_ITEM', payload: 'clip' },
      { type: 'SET_ZOOM', payload: 2 },
    ] as const;

    const next = actions.reduce(editorHistoryReducer, initial);

    expect(next.present).toMatchObject({
      playing: true,
      currentFrame: 12,
      selectedItemId: 'clip',
      zoom: 2,
    });
    expect(next.past).toHaveLength(0);
  });

  it('does not create an undo step for a no-op item update', () => {
    const initial = createEditorHistoryState(makeState());
    const unchanged = editorHistoryReducer(initial, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { from: 0 } },
    });

    expect(unchanged).toBe(initial);
    expect(unchanged.past).toHaveLength(0);
  });

  it('clears redo when a new edit is made after undo', () => {
    const initial = createEditorHistoryState(makeState());
    const moved = editorHistoryReducer(initial, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { from: 45 } },
    });
    const undone = editorHistoryReducer(moved, { type: 'UNDO' });
    const replacement = editorHistoryReducer(undone, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { from: 60 } },
    });

    expect(replacement.present.tracks[0].items[0].from).toBe(60);
    expect(replacement.future).toHaveLength(0);
    expect(editorHistoryReducer(replacement, { type: 'REDO' })).toBe(replacement);
  });

  it('groups a continuous trim into one undo step', () => {
    let history = createEditorHistoryState(makeState());
    history = editorHistoryReducer(history, { type: 'BEGIN_HISTORY_GROUP' });
    history = editorHistoryReducer(history, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { durationInFrames: 40 } },
    });
    history = editorHistoryReducer(history, {
      type: 'UPDATE_ITEM',
      payload: { trackId: 'primary', itemId: 'clip', updates: { durationInFrames: 50 } },
    });
    history = editorHistoryReducer(history, { type: 'END_HISTORY_GROUP' });

    expect(history.present.tracks[0].items[0].durationInFrames).toBe(50);
    expect(history.past).toHaveLength(1);

    const undone = editorHistoryReducer(history, { type: 'UNDO' });
    expect(undone.present.tracks[0].items[0].durationInFrames).toBe(30);
  });

  it('restores only Timeline document fields and keeps the current asset library', () => {
    const initial = createEditorHistoryState(makeState());
    const withAsset = editorHistoryReducer(initial, {
      type: 'ADD_ASSET',
      payload: {
        id: 'asset-new',
        name: 'new.mp4',
        type: 'video',
        src: 'new.mp4',
        createdAt: 1,
      },
    });
    const withTrack = editorHistoryReducer(withAsset, {
      type: 'ADD_TRACK',
      payload: { id: 'audio', name: 'Audio', category: 'audio', items: [] } as Track,
    });

    const undone = editorHistoryReducer(withTrack, { type: 'UNDO' });
    expect(undone.present.tracks.some((track) => track.id === 'audio')).toBe(false);
    expect(undone.present.assets.map((asset) => asset.id)).toEqual(['asset-new']);
  });
});
