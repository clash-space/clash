import { describe, it, expect } from 'vitest';
import { editorReducer, editorInitialState } from './EditorContext';
import type { Track, VideoItem, EditorState } from '../types';

const makeTrack = (id: string, items: any[] = []): Track => ({ id, name: id, items });

const makeVideo = (id: string, from: number, dur: number, sourceStart = 0): VideoItem => ({
  id,
  type: 'video',
  src: `${id}.mp4`,
  from,
  durationInFrames: dur,
  sourceStartInFrames: sourceStart,
});

const seedState = (tracks: Track[], overrides: Partial<EditorState> = {}): EditorState => ({
  ...editorInitialState,
  tracks,
  ...overrides,
});

describe('editorReducer — track ops', () => {
  it('ADD_TRACK appends', () => {
    const s = editorReducer(seedState([]), { type: 'ADD_TRACK', payload: makeTrack('t1') });
    expect(s.tracks.map((t) => t.id)).toEqual(['t1']);
  });

  it('INSERT_TRACK at a specific index', () => {
    const s = editorReducer(
      seedState([makeTrack('a'), makeTrack('b')]),
      { type: 'INSERT_TRACK', payload: { track: makeTrack('mid'), index: 1 } },
    );
    expect(s.tracks.map((t) => t.id)).toEqual(['a', 'mid', 'b']);
  });

  it('REMOVE_TRACK removes by id and clears selectedTrackId if matching', () => {
    const s = editorReducer(
      seedState([makeTrack('a'), makeTrack('b')], { selectedTrackId: 'b' }),
      { type: 'REMOVE_TRACK', payload: 'b' },
    );
    expect(s.tracks.map((t) => t.id)).toEqual(['a']);
    expect(s.selectedTrackId).toBeNull();
  });

  it('REMOVE_TRACK preserves selectedTrackId when not matching', () => {
    const s = editorReducer(
      seedState([makeTrack('a'), makeTrack('b')], { selectedTrackId: 'a' }),
      { type: 'REMOVE_TRACK', payload: 'b' },
    );
    expect(s.selectedTrackId).toBe('a');
  });

  it('UPDATE_TRACK merges partial updates', () => {
    const s = editorReducer(
      seedState([makeTrack('a')]),
      { type: 'UPDATE_TRACK', payload: { id: 'a', updates: { name: 'renamed', locked: true } } },
    );
    expect(s.tracks[0].name).toBe('renamed');
    expect(s.tracks[0].locked).toBe(true);
  });

  it('REORDER_TRACKS replaces the array wholesale', () => {
    const a = makeTrack('a');
    const b = makeTrack('b');
    const s = editorReducer(seedState([a, b]), { type: 'REORDER_TRACKS', payload: [b, a] });
    expect(s.tracks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('editorReducer — item ops', () => {
  it('ADD_ITEM appends to the matching track', () => {
    const s = editorReducer(
      seedState([makeTrack('t1'), makeTrack('t2')]),
      { type: 'ADD_ITEM', payload: { trackId: 't1', item: makeVideo('v1', 0, 60) } },
    );
    expect(s.tracks[0].items.map((i) => i.id)).toEqual(['v1']);
    expect(s.tracks[1].items).toHaveLength(0);
  });

  it('REMOVE_ITEM auto-deletes the parent track when it becomes empty', () => {
    const s = editorReducer(
      seedState([
        makeTrack('only', [makeVideo('v1', 0, 60)]),
        makeTrack('keep', [makeVideo('v2', 0, 60)]),
      ]),
      { type: 'REMOVE_ITEM', payload: { trackId: 'only', itemId: 'v1' } },
    );
    expect(s.tracks.map((t) => t.id)).toEqual(['keep']);
  });

  it('REMOVE_ITEM keeps the track if it still has other items', () => {
    const s = editorReducer(
      seedState([makeTrack('t', [makeVideo('a', 0, 30), makeVideo('b', 30, 30)])]),
      { type: 'REMOVE_ITEM', payload: { trackId: 't', itemId: 'a' } },
    );
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].items.map((i) => i.id)).toEqual(['b']);
  });

  it('REMOVE_ITEM clears selectedItemId if it matched the removed item', () => {
    const s = editorReducer(
      seedState([makeTrack('t', [makeVideo('a', 0, 30), makeVideo('b', 30, 30)])], { selectedItemId: 'a' }),
      { type: 'REMOVE_ITEM', payload: { trackId: 't', itemId: 'a' } },
    );
    expect(s.selectedItemId).toBeNull();
  });

  it('UPDATE_ITEM merges partial updates without disturbing siblings', () => {
    const s = editorReducer(
      seedState([makeTrack('t', [makeVideo('a', 0, 30), makeVideo('b', 30, 30)])]),
      { type: 'UPDATE_ITEM', payload: { trackId: 't', itemId: 'a', updates: { durationInFrames: 50 } } },
    );
    expect(s.tracks[0].items[0].durationInFrames).toBe(50);
    expect(s.tracks[0].items[1].durationInFrames).toBe(30);
  });
});

describe('editorReducer — SPLIT_ITEM', () => {
  it('splits a video item at a frame inside its bounds; second piece advances sourceStartInFrames', () => {
    const item = makeVideo('clip', 100, 60, /* sourceStart */ 200);
    const s = editorReducer(
      seedState([makeTrack('t', [item])]),
      { type: 'SPLIT_ITEM', payload: { trackId: 't', itemId: 'clip', splitFrame: 130 } },
    );
    const items = s.tracks[0].items as VideoItem[];
    expect(items).toHaveLength(2);
    // First piece: same start, half the duration
    expect(items[0].id).toBe('clip');
    expect(items[0].from).toBe(100);
    expect(items[0].durationInFrames).toBe(30);
    expect(items[0].sourceStartInFrames).toBe(200);
    // Second piece: starts at split frame, sourceStart advances by the consumed frames
    expect(items[1].id).toMatch(/^clip-split-/);
    expect(items[1].from).toBe(130);
    expect(items[1].durationInFrames).toBe(30);
    expect(items[1].sourceStartInFrames).toBe(230); // 200 + 30 consumed
  });

  it('SPLIT_ITEM is a no-op when splitFrame is at or before item.from', () => {
    const item = makeVideo('clip', 100, 60, 0);
    const s = editorReducer(
      seedState([makeTrack('t', [item])]),
      { type: 'SPLIT_ITEM', payload: { trackId: 't', itemId: 'clip', splitFrame: 100 } },
    );
    expect(s.tracks[0].items).toHaveLength(1);
    expect(s.tracks[0].items[0].id).toBe('clip');
  });

  it('SPLIT_ITEM is a no-op when splitFrame is at or after item.end', () => {
    const item = makeVideo('clip', 100, 60, 0);
    const s = editorReducer(
      seedState([makeTrack('t', [item])]),
      { type: 'SPLIT_ITEM', payload: { trackId: 't', itemId: 'clip', splitFrame: 160 } },
    );
    expect(s.tracks[0].items).toHaveLength(1);
  });

  it('SPLIT_ITEM does not touch other tracks', () => {
    const item = makeVideo('clip', 0, 60, 0);
    const s = editorReducer(
      seedState([
        makeTrack('t', [item]),
        makeTrack('other', [makeVideo('o', 0, 60)]),
      ]),
      { type: 'SPLIT_ITEM', payload: { trackId: 't', itemId: 'clip', splitFrame: 30 } },
    );
    expect(s.tracks[0].items).toHaveLength(2);
    expect(s.tracks[1].items).toHaveLength(1);
    expect(s.tracks[1].items[0].id).toBe('o');
  });
});

describe('editorReducer — selection / playback / scalars', () => {
  it('SELECT_ITEM and SELECT_TRACK store the id', () => {
    let s = editorReducer(seedState([]), { type: 'SELECT_ITEM', payload: 'x' });
    expect(s.selectedItemId).toBe('x');
    s = editorReducer(s, { type: 'SELECT_ITEM', payload: null });
    expect(s.selectedItemId).toBeNull();
    s = editorReducer(s, { type: 'SELECT_TRACK', payload: 'tt' });
    expect(s.selectedTrackId).toBe('tt');
  });

  it('SET_CURRENT_FRAME / SET_PLAYING / SET_ZOOM / SET_DURATION / SET_COMPOSITION_SIZE', () => {
    let s = editorReducer(seedState([]), { type: 'SET_CURRENT_FRAME', payload: 42 });
    expect(s.currentFrame).toBe(42);
    s = editorReducer(s, { type: 'SET_PLAYING', payload: true });
    expect(s.playing).toBe(true);
    s = editorReducer(s, { type: 'SET_ZOOM', payload: 2 });
    expect(s.zoom).toBe(2);
    s = editorReducer(s, { type: 'SET_DURATION', payload: 3000 });
    expect(s.durationInFrames).toBe(3000);
    s = editorReducer(s, { type: 'SET_COMPOSITION_SIZE', payload: { width: 1280, height: 720 } });
    expect(s.compositionWidth).toBe(1280);
    expect(s.compositionHeight).toBe(720);
  });

  it('ADD_ASSET / REMOVE_ASSET maintain the assets array', () => {
    const asset = {
      id: 'a',
      name: 'A',
      type: 'video' as const,
      src: 'a.mp4',
      createdAt: 0,
    };
    let s = editorReducer(seedState([]), { type: 'ADD_ASSET', payload: asset });
    expect(s.assets.map((a) => a.id)).toEqual(['a']);
    s = editorReducer(s, { type: 'REMOVE_ASSET', payload: 'a' });
    expect(s.assets).toEqual([]);
  });
});
