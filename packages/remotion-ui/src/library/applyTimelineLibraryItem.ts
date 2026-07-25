import type {
  EditorAction,
  EditorState,
  EffectInstanceRef,
  Item,
  Track,
  TrackCategory,
  TransitionType,
} from '@master-clash/remotion-core';
import { isSubtitleTextItem, resolveAudioGainDb } from '@master-clash/remotion-core';
import type { TimelineLibraryCatalogRecord } from './timelineLibraryCatalog';

export type TimelineLibraryApplication = {
  actions: EditorAction[];
  disabledReason?: string;
};

export const NO_CONTINUOUS_TRANSITION_REASON = 'No continuous clips at this position. Transition cannot be added.';

type BuildTimelineLibraryApplicationOptions = {
  state: EditorState;
  record: TimelineLibraryCatalogRecord;
  createId: (prefix: string) => string;
  targetTrackId?: string;
  transitionTarget?: {
    trackId: string;
    frame: number;
  };
};

const visualItemTypes = new Set<Item['type']>([
  'video',
  'image',
  'solid',
  'sticker',
  'composition',
  'derived-overlay',
]);

const transitionClipTypes = new Set<Item['type']>([
  'video',
  'image',
  'solid',
]);

export type TimelineTransitionBoundary = {
  fromItem: Item;
  toItem: Item;
  frame: number;
};

/** A transition edit point exists only where two visual clips touch exactly. */
export function getContinuousTransitionBoundaries(track: Track): TimelineTransitionBoundary[] {
  const clips = track.items
    .filter((item) => transitionClipTypes.has(item.type))
    .slice()
    .sort((left, right) => left.from - right.from || left.id.localeCompare(right.id));

  const boundaries: TimelineTransitionBoundary[] = [];
  for (let index = 0; index < clips.length - 1; index += 1) {
    const fromItem = clips[index];
    const toItem = clips[index + 1];
    if (!fromItem || !toItem) continue;
    const frame = fromItem.from + fromItem.durationInFrames;
    if (frame !== toItem.from) continue;
    boundaries.push({ fromItem, toItem, frame });
  }
  return boundaries;
}

function selectedItem(state: EditorState): { track: Track; item: Item } | null {
  if (!state.selectedItemId) return null;
  for (const track of state.tracks) {
    const item = track.items.find((candidate) => candidate.id === state.selectedItemId);
    if (item) return { track, item };
  }
  return null;
}

function firstTrack(
  state: EditorState,
  category: TrackCategory,
  role: Track['role'],
  targetTrackId?: string,
): Track | undefined {
  const target = targetTrackId ? state.tracks.find((track) => track.id === targetTrackId) : undefined;
  return target?.category === category && target.role === role
    ? target
    : state.tracks.find((track) => track.category === category && track.role === role);
}

function appendItemActions(options: {
  state: EditorState;
  createId: (prefix: string) => string;
  category: TrackCategory;
  trackName: string;
  role: Track['role'];
  item: Item;
  targetTrackId?: string;
}): EditorAction[] {
  const existing = firstTrack(options.state, options.category, options.role, options.targetTrackId);
  const actions: EditorAction[] = existing
    ? [{ type: 'ADD_ITEM', payload: { trackId: existing.id, item: options.item } }]
    : [{
        type: 'ADD_TRACK',
        payload: {
          id: options.createId(`library-${options.category}-track`),
          name: options.trackName,
          role: options.role,
          category: options.category,
          items: [options.item],
        },
      }];
  actions.push({ type: 'SELECT_ITEM', payload: options.item.id });
  const itemEnd = options.item.from + options.item.durationInFrames;
  if (itemEnd > options.state.durationInFrames) {
    actions.push({ type: 'SET_DURATION', payload: itemEnd });
  }
  return actions;
}

function effectRef(artifact: {
  effectId: string;
  effectVersion: number;
  params?: Record<string, unknown>;
}): EffectInstanceRef {
  return {
    effectId: artifact.effectId,
    effectVersion: artifact.effectVersion,
    params: artifact.params as EffectInstanceRef['params'],
  };
}

function legacyTransitionType(effectId: string): TransitionType {
  const suffix = effectId.split('/').pop();
  switch (suffix) {
    case 'push-left':
    case 'push-right':
    case 'slide-up':
    case 'slide-down':
    case 'wipe-left':
    case 'wipe-right':
    case 'circle-wipe':
    case 'zoom-in':
      return suffix;
    default:
      return 'crossfade';
  }
}

function disabled(reason: string): TimelineLibraryApplication {
  return { actions: [], disabledReason: reason };
}

export function buildTimelineLibraryApplication({
  state,
  record,
  createId,
  targetTrackId,
  transitionTarget,
}: BuildTimelineLibraryApplicationOptions): TimelineLibraryApplication {
  const { item: libraryItem } = record;
  const frame = Math.max(0, state.currentFrame);

  switch (libraryItem.category) {
    case 'text': {
      const item: Item = {
        id: createId('library-text'),
        type: 'text',
        from: frame,
        durationInFrames: 90,
        text: libraryItem.artifact.text,
        color: libraryItem.artifact.color,
        fontSize: libraryItem.artifact.fontSize,
        fontFamily: libraryItem.artifact.fontFamily,
        fontWeight: libraryItem.artifact.fontWeight,
        properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 },
      };
      return {
        actions: appendItemActions({ state, createId, category: 'text', trackName: 'Text', role: 'subtitle', item, targetTrackId }),
      };
    }

    case 'stickers': {
      const item: Item = {
        id: createId('library-sticker'),
        type: 'sticker',
        src: libraryItem.artifact.src,
        assetId: libraryItem.artifact.assetId,
        from: frame,
        durationInFrames: 90,
        properties: { x: 0, y: 0, width: 0.28, height: 0.28, opacity: 1 },
      };
      return {
        actions: appendItemActions({ state, createId, category: 'visual', trackName: 'Stickers', role: 'overlay', item, targetTrackId }),
      };
    }

    case 'motion-graphics':
    case 'templates': {
      const spec = libraryItem.artifact.spec;
      const item: Item = {
        id: createId('library-composition'),
        type: 'composition',
        compositionKind: 'motion-graphics',
        runtime: 'html',
        compositionId: spec.id,
        sourcePath: libraryItem.artifact.sourcePath ?? `library/${spec.id}.html`,
        ...(libraryItem.artifact.renderedAssetPath
          ? { renderedAssetPath: libraryItem.artifact.renderedAssetPath }
          : {}),
        spec,
        from: frame,
        durationInFrames: spec.durationInFrames,
      };
      return {
        actions: appendItemActions({ state, createId, category: 'effect', trackName: 'Motion Graphics', role: 'overlay', item, targetTrackId }),
      };
    }

    case 'sound-effects': {
      if (!record.runtimeAsset) return disabled('This sound effect is not installed.');
      const item: Item = {
        id: createId('library-audio'),
        type: 'audio',
        assetId: record.runtimeAsset.id,
        src: record.runtimeAsset.src,
        waveform: record.runtimeAsset.waveform,
        from: frame,
        durationInFrames: Math.max(1, Math.round((record.runtimeAsset.duration ?? 1) * state.fps)),
        audioGainDb: 0,
      };
      return {
        actions: [
          { type: 'UPSERT_ASSET', payload: record.runtimeAsset },
          ...appendItemActions({ state, createId, category: 'audio', trackName: 'Sound Effects', role: 'sfx', item, targetTrackId }),
        ],
      };
    }

    case 'fx':
    case 'zoom':
    case 'luts':
    case 'filters':
    case 'adjustments': {
      const selected = selectedItem(state);
      if (!selected || !visualItemTypes.has(selected.item.type)) {
        return disabled('Select a visual item to apply this effect.');
      }
      if (libraryItem.artifact.kind !== 'effect-ref') {
        return disabled('This color look is not installed.');
      }
      const effects = [...(selected.item.effects ?? []), effectRef(libraryItem.artifact)];
      return {
        actions: [{
          type: 'UPDATE_ITEM',
          payload: { trackId: selected.track.id, itemId: selected.item.id, updates: { effects } },
        }],
      };
    }

    case 'transitions': {
      let boundary: TimelineTransitionBoundary | undefined;
      if (transitionTarget) {
        const track = state.tracks.find((candidate) => candidate.id === transitionTarget.trackId);
        boundary = track
          ? getContinuousTransitionBoundaries(track).find((candidate) => candidate.frame === transitionTarget.frame)
          : undefined;
        if (!boundary) {
          return disabled(NO_CONTINUOUS_TRANSITION_REASON);
        }
      } else {
        const selected = selectedItem(state);
        if (selected?.item.type === 'transition') {
          const selectedTransition = selected.item;
          boundary = state.tracks
            .flatMap((track) => getContinuousTransitionBoundaries(track))
            .find((candidate) => (
              candidate.fromItem.id === selectedTransition.fromItemId
              && candidate.toItem.id === selectedTransition.toItemId
            ));
          if (!boundary) {
            return disabled(NO_CONTINUOUS_TRANSITION_REASON);
          }
        } else if (!selected || !transitionClipTypes.has(selected.item.type)) {
          return disabled(NO_CONTINUOUS_TRANSITION_REASON);
        } else {
          const boundaries = getContinuousTransitionBoundaries(selected.track);
          boundary = boundaries.find((candidate) => candidate.fromItem.id === selected.item.id)
            ?? boundaries.find((candidate) => candidate.toItem.id === selected.item.id);
          if (!boundary) {
            return disabled(NO_CONTINUOUS_TRANSITION_REASON);
          }
        }
      }
      const { fromItem, toItem } = boundary;
      const durationInFrames = Math.max(1, Math.min(15, fromItem.durationInFrames, toItem.durationInFrames));
      const transitionFrom = boundary.frame - Math.floor(durationInFrames / 2);
      const existing = state.tracks
        .map((track) => ({
          track,
          item: track.items.find((candidate) => (
            candidate.type === 'transition'
            && candidate.fromItemId === fromItem.id
            && candidate.toItemId === toItem.id
          )),
        }))
        .find((candidate) => candidate.item);
      if (existing?.item) {
        return {
          actions: [
            {
              type: 'UPDATE_ITEM',
              payload: {
                trackId: existing.track.id,
                itemId: existing.item.id,
                updates: {
                  from: transitionFrom,
                  durationInFrames,
                  transitionType: legacyTransitionType(libraryItem.artifact.effectId),
                  effect: effectRef(libraryItem.artifact),
                },
              },
            },
            { type: 'SELECT_ITEM', payload: existing.item.id },
          ],
        };
      }
      const transition: Item = {
        id: createId('library-transition'),
        type: 'transition',
        from: transitionFrom,
        durationInFrames,
        transitionType: legacyTransitionType(libraryItem.artifact.effectId),
        fromItemId: fromItem.id,
        toItemId: toItem.id,
        effect: effectRef(libraryItem.artifact),
      };
      return {
        actions: appendItemActions({ state, createId, category: 'effect', trackName: 'Transitions', role: 'transition', item: transition, targetTrackId }),
      };
    }

    case 'audio-fx': {
      const selected = selectedItem(state);
      if (!selected || selected.item.type !== 'audio') {
        return disabled('Select an audio item to apply this audio effect.');
      }
      const processorId = libraryItem.artifact.processorId;
      const updates = processorId.endsWith('audio-fade-in')
        ? { audioFadeInFrames: 15 }
        : processorId.endsWith('audio-fade-out')
          ? { audioFadeOutFrames: 15 }
          : processorId.endsWith('voice-boost')
            ? { audioGainDb: Math.min(12, resolveAudioGainDb(selected.item) + 2) }
            : null;
      if (!updates) return disabled('This audio processor is not installed.');
      return {
        actions: [{
          type: 'UPDATE_ITEM',
          payload: { trackId: selected.track.id, itemId: selected.item.id, updates },
        }],
      };
    }

    case 'captions': {
      const selected = selectedItem(state);
      if (!selected || selected.track.role !== 'subtitle' || !isSubtitleTextItem(selected.item)) {
        return disabled('Select a structured text item on a subtitle track to apply this style.');
      }
      return {
        actions: [{
          type: 'UPDATE_ITEM',
          payload: {
            trackId: selected.track.id,
            itemId: selected.item.id,
            updates: { style: { ...(selected.item.style ?? {}), ...libraryItem.artifact.style } },
          },
        }],
      };
    }
  }
}
