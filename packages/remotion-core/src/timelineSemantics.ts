import type {
  AudioItem,
  CompositionItem,
  DerivedOverlayItem,
  EffectInstanceRef,
  ImageItem,
  Item,
  TimelineDsl,
  Track,
  TrackRole,
  TransitionItem,
  SubtitleTextItem,
  TextItem,
  VideoItem,
} from './types';
import { isSubtitleTextItem } from './types';
import {
  canTrackAcceptItem,
  inferTrackCategory,
  itemTrackCategory,
  TRACK_CATEGORY_ORDER,
} from './trackCategories';

export type { TimelineDsl, TrackRole } from './types';

export type TimelineIssueSeverity = 'error' | 'warning';

export type TimelineIssue = {
  severity: TimelineIssueSeverity;
  code:
    | 'timeline.invalid_fps'
    | 'timeline.invalid_size'
    | 'track.duplicate_id'
    | 'track.missing_id'
    | 'track.role_item_mismatch'
    | 'track.category_item_mismatch'
    | 'track.category_order_mismatch'
    | 'track.mixed_item_categories'
    | 'item.duplicate_id'
    | 'item.missing_id'
    | 'item.invalid_from'
    | 'item.invalid_duration'
    | 'item.unresolved_source'
    | 'item.transition_missing_ref'
    | 'item.transition_non_continuous'
    | 'item.transition_detached_range'
    | 'item.transition_duration_exceeds_handles'
    | 'item.invalid_effect_ref'
    | 'item.invalid_composition'
    | 'item.invalid_caption'
    | 'item.invalid_derived_overlay'
    | 'command.track_not_found'
    | 'command.item_not_found'
    | 'command.invalid_input';
  message: string;
  path: string;
};

export type TimelineValidationContext = {
  resolvableSourceNodeIds?: ReadonlySet<string>;
  resolvableAssetIds?: ReadonlySet<string>;
};

export type TimelineValidationResult = {
  ok: boolean;
  issues: TimelineIssue[];
  durationInFrames: number;
};

export type TimelineCommand =
  | {
      type: 'add_clip';
      trackId: string;
      sourceNodeId: string;
      assetId?: string;
      itemType: 'video' | 'audio' | 'image' | 'text';
      from: number;
      durationInFrames: number;
      id?: string;
      text?: string;
    }
  | {
      type: 'trim_clip';
      trackId: string;
      itemId: string;
      from: number;
      durationInFrames: number;
    }
  | {
      type: 'split_clip';
      trackId: string;
      itemId: string;
      splitFrame: number;
    };

export type TimelineCommandResult =
  | { ok: true; dsl: TimelineDsl; issues: TimelineIssue[] }
  | { ok: false; dsl: TimelineDsl; issues: TimelineIssue[] };

const ROLE_ALLOWED_TYPES: Record<TrackRole, ReadonlySet<Item['type']>> = {
  'primary-video': new Set(['video', 'image', 'solid']),
  'b-roll': new Set(['video', 'image', 'solid']),
  overlay: new Set(['video', 'image', 'solid', 'text', 'sticker', 'composition', 'derived-overlay']),
  subtitle: new Set(['text']),
  narration: new Set(['audio', 'video']),
  dialogue: new Set(['audio', 'video']),
  music: new Set(['audio']),
  sfx: new Set(['audio']),
  transition: new Set(['transition']),
  mixed: new Set(['video', 'audio', 'image', 'solid', 'text', 'sticker', 'composition', 'derived-overlay', 'transition']),
};

function issue(code: TimelineIssue['code'], message: string, path: string): TimelineIssue {
  return { severity: 'error', code, message, path };
}

function isMediaItem(item: Item): item is VideoItem | AudioItem | ImageItem {
  return item.type === 'video' || item.type === 'audio' || item.type === 'image';
}

function itemSourceNodeId(item: Item): string | undefined {
  return typeof item.sourceNodeId === 'string' && item.sourceNodeId.trim() ? item.sourceNodeId : undefined;
}

function itemAssetId(item: Item): string | undefined {
  return typeof item.assetId === 'string' && item.assetId.trim() ? item.assetId : undefined;
}

function timelineEnd(tracks: Track[]): number {
  let end = 0;
  for (const track of tracks) {
    for (const item of track.items) {
      end = Math.max(end, item.from + item.durationInFrames);
    }
  }
  return end;
}

function isResolved(item: Item, context: TimelineValidationContext): boolean {
  if (!isMediaItem(item) && item.type !== 'sticker') return true;

  const sourceNodeId = itemSourceNodeId(item);
  if (sourceNodeId && context.resolvableSourceNodeIds) {
    return context.resolvableSourceNodeIds.has(sourceNodeId);
  }

  const assetId = itemAssetId(item);
  if (assetId && context.resolvableAssetIds) {
    return context.resolvableAssetIds.has(assetId);
  }

  if (!context.resolvableSourceNodeIds && !context.resolvableAssetIds) {
    return Boolean(sourceNodeId || assetId || ('src' in item && typeof item.src === 'string' && item.src.trim()));
  }

  return false;
}

function validateEffectRef(ref: EffectInstanceRef): string | null {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(ref.effectId)) {
    return 'Effect id must be a namespaced lower-case identifier.';
  }
  if (!Number.isInteger(ref.effectVersion) || ref.effectVersion < 1) {
    return 'Effect version must be a positive integer.';
  }
  if (ref.params == null) return null;
  if (typeof ref.params !== 'object' || Array.isArray(ref.params)) {
    return 'Effect params must be an object.';
  }
  for (const [name, value] of Object.entries(ref.params)) {
    const validScalar =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    const validVector =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((component) => typeof component === 'number' && Number.isFinite(component));
    if (!validScalar && !validVector) {
      return `Effect parameter "${name}" must be a finite JSON scalar or numeric vector.`;
    }
  }
  return null;
}

function isLocalProjectPath(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function validateCompositionItem(item: CompositionItem, path: string, issues: TimelineIssue[]) {
  if (item.runtime !== 'html' && item.runtime !== 'react' && item.runtime !== 'remotion') {
    issues.push(issue('item.invalid_composition', 'Composition item runtime must be html, react, or remotion.', `${path}.runtime`));
  }
  if (!item.compositionId || typeof item.compositionId !== 'string') {
    issues.push(issue('item.invalid_composition', 'Composition item must have a compositionId.', `${path}.compositionId`));
  }
  if (!isLocalProjectPath(item.sourcePath)) {
    issues.push(issue('item.invalid_composition', 'Composition sourcePath must be a local project path, not a remote URL.', `${path}.sourcePath`));
  }
  if (item.runtime === 'html' && item.compositionKind === 'motion-graphics' && !item.spec) {
    issues.push(issue('item.invalid_composition', 'HTML motion-graphics composition items must include a first-party spec for preview.', `${path}.spec`));
  }
  if (item.renderedAssetPath !== undefined && !isLocalProjectPath(item.renderedAssetPath)) {
    issues.push(issue('item.invalid_composition', 'Composition renderedAssetPath must be a local project path, not a remote URL.', `${path}.renderedAssetPath`));
  }
  if (item.runtime !== 'html' && !isLocalProjectPath(item.renderedAssetPath)) {
    issues.push(issue('item.invalid_composition', 'React/Remotion composition items must include a local renderedAssetPath for timeline preview.', `${path}.renderedAssetPath`));
  }
}

function validateCaptionItem(item: SubtitleTextItem, path: string, issues: TimelineIssue[]) {
  const wordRefs = Array.isArray(item.wordRefs) ? item.wordRefs : [];
  const wordRefById = new Map<string, { sourceStartFrame: number; sourceEndFrame: number }>();
  const sourceToOutputMap = Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap : [];

  if (wordRefs.length === 0) {
    issues.push(issue('item.invalid_caption', 'Caption item must include source word references.', `${path}.wordRefs`));
  }
  wordRefs.forEach((word, wordIndex) => {
    const wordPath = `${path}.wordRefs[${wordIndex}]`;
    if (!word.id || typeof word.id !== 'string') {
      issues.push(issue('item.invalid_caption', 'Caption word reference must have an id.', `${wordPath}.id`));
    }
    if (typeof word.text !== 'string') {
      issues.push(issue('item.invalid_caption', 'Caption word reference text must be a string.', `${wordPath}.text`));
    }
    if (!isValidFrameRange(word.sourceStartFrame, word.sourceEndFrame)) {
      issues.push(issue('item.invalid_caption', 'Caption word reference must include a valid source frame range.', wordPath));
    }
    if (word.id && typeof word.id === 'string' && isValidFrameRange(word.sourceStartFrame, word.sourceEndFrame)) {
      wordRefById.set(word.id, {
        sourceStartFrame: word.sourceStartFrame,
        sourceEndFrame: word.sourceEndFrame,
      });
    }
  });

  if (sourceToOutputMap.length === 0) {
    issues.push(issue('item.invalid_caption', 'Caption item must include a source-to-output frame map.', `${path}.sourceToOutputMap`));
  }
  sourceToOutputMap.forEach((entry, mapIndex) => {
    const mapPath = `${path}.sourceToOutputMap[${mapIndex}]`;
    if (!isValidFrameRange(entry.sourceStartFrame, entry.sourceEndFrame)) {
      issues.push(issue('item.invalid_caption', 'Caption source-to-output map must include a valid source frame range.', mapPath));
    }
    if (!isValidFrameRange(entry.outputStartFrame, entry.outputEndFrame)) {
      issues.push(issue('item.invalid_caption', 'Caption source-to-output map must include a valid output frame range.', mapPath));
    }
  });

  if (!Array.isArray(item.cues) || item.cues.length === 0) {
    issues.push(issue('item.invalid_caption', 'Caption item must contain at least one cue.', `${path}.cues`));
    return;
  }
  item.cues.forEach((cue, cueIndex) => {
    const cuePath = `${path}.cues[${cueIndex}]`;
    if (!cue.id || typeof cue.id !== 'string') {
      issues.push(issue('item.invalid_caption', 'Caption cue must have an id.', `${cuePath}.id`));
    }
    if (!Number.isInteger(cue.startFrame) || cue.startFrame < 0) {
      issues.push(issue('item.invalid_caption', 'Caption cue startFrame must be a non-negative integer.', `${cuePath}.startFrame`));
    }
    if (!Number.isInteger(cue.durationInFrames) || cue.durationInFrames <= 0) {
      issues.push(issue('item.invalid_caption', 'Caption cue durationInFrames must be a positive integer.', `${cuePath}.durationInFrames`));
    }
    if (typeof cue.text !== 'string' || cue.text.trim().length === 0) {
      issues.push(issue('item.invalid_caption', 'Caption cue text must be non-empty.', `${cuePath}.text`));
    }
    if (
      Number.isInteger(cue.startFrame) &&
      Number.isInteger(cue.durationInFrames) &&
      cue.durationInFrames > 0 &&
      cue.startFrame + cue.durationInFrames > item.durationInFrames
    ) {
      issues.push(issue('item.invalid_caption', 'Caption cue must fit inside the caption item duration.', cuePath));
    }
    if (!Array.isArray(cue.wordIds) || cue.wordIds.length === 0) {
      issues.push(issue('item.invalid_caption', 'Caption cue must reference source word ids.', `${cuePath}.wordIds`));
    } else {
      for (const wordId of cue.wordIds) {
        if (!wordRefById.has(wordId)) {
          issues.push(issue('item.invalid_caption', `Caption cue references unknown word id "${wordId}".`, `${cuePath}.wordIds`));
        }
      }
    }

    if (!isValidFrameRange(cue.sourceStartFrame, cue.sourceEndFrame)) {
      issues.push(issue('item.invalid_caption', 'Caption cue must include a valid source frame range.', cuePath));
      return;
    }

    const cueEndFrame = cue.startFrame + cue.durationInFrames;
    const matchingMap = sourceToOutputMap.find((entry) =>
      isValidFrameRange(entry.sourceStartFrame, entry.sourceEndFrame) &&
      isValidFrameRange(entry.outputStartFrame, entry.outputEndFrame) &&
      cue.sourceStartFrame! >= entry.sourceStartFrame &&
      cue.sourceEndFrame! <= entry.sourceEndFrame &&
      cue.startFrame >= entry.outputStartFrame &&
      cueEndFrame <= entry.outputEndFrame
    );
    if (!matchingMap) {
      issues.push(issue('item.invalid_caption', 'Caption cue must be covered by source-to-output map.', cuePath));
    }
  });
}

function isValidFrameRange(startFrame: unknown, endFrame: unknown): boolean {
  return typeof startFrame === 'number' &&
    typeof endFrame === 'number' &&
    Number.isInteger(startFrame) &&
    Number.isInteger(endFrame) &&
    startFrame >= 0 &&
    endFrame > startFrame;
}

function validateDerivedOverlayItem(item: DerivedOverlayItem, path: string, issues: TimelineIssue[]) {
  if (item.mediaType !== 'image' && item.mediaType !== 'video') {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay mediaType must be image or video.', `${path}.mediaType`));
  }
  if (!isLocalProjectPath(item.src)) {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay src must be a local project/asset path, not a remote URL.', `${path}.src`));
  }
  if (!item.sourceAssetId || typeof item.sourceAssetId !== 'string') {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay must record sourceAssetId.', `${path}.sourceAssetId`));
  }
  if (!item.derivedAssetId || typeof item.derivedAssetId !== 'string') {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay must record derivedAssetId.', `${path}.derivedAssetId`));
  }
  if (item.assetId && item.derivedAssetId && item.assetId !== item.derivedAssetId) {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay assetId must match derivedAssetId when present.', `${path}.assetId`));
  }
  if (item.sourceAssetId && item.derivedAssetId && item.sourceAssetId === item.derivedAssetId) {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay must be copy-on-write: sourceAssetId and derivedAssetId cannot match.', path));
  }
  if (!item.derivation || typeof item.derivation.kind !== 'string') {
    issues.push(issue('item.invalid_derived_overlay', 'Derived overlay must record derivation.kind.', `${path}.derivation`));
  }
}

const TRANSITION_CLIP_TYPES = new Set<Item['type']>(['video', 'image', 'solid']);

function resolveContinuousTransitionBoundary(
  dsl: TimelineDsl,
  transition: TransitionItem,
): { fromItem: Item; toItem: Item; frame: number } | null {
  if (!transition.fromItemId || !transition.toItemId) return null;
  for (const track of dsl.tracks) {
    const fromItem = track.items.find((item) => item.id === transition.fromItemId);
    const toItem = track.items.find((item) => item.id === transition.toItemId);
    if (!fromItem || !toItem) continue;
    if (!TRANSITION_CLIP_TYPES.has(fromItem.type) || !TRANSITION_CLIP_TYPES.has(toItem.type)) {
      return null;
    }
    const frame = fromItem.from + fromItem.durationInFrames;
    return frame === toItem.from ? { fromItem, toItem, frame } : null;
  }
  return null;
}

export function validateTimelineDsl(
  dsl: TimelineDsl,
  context: TimelineValidationContext = {},
): TimelineValidationResult {
  const issues: TimelineIssue[] = [];
  const trackIds = new Set<string>();
  const itemIds = new Set<string>();

  if (!Number.isFinite(dsl.fps) || dsl.fps <= 0) {
    issues.push(issue('timeline.invalid_fps', 'Timeline fps must be a positive number.', 'fps'));
  }
  if (!Number.isFinite(dsl.compositionWidth) || dsl.compositionWidth <= 0 || !Number.isFinite(dsl.compositionHeight) || dsl.compositionHeight <= 0) {
    issues.push(issue('timeline.invalid_size', 'Timeline composition size must be positive.', 'composition'));
  }

  dsl.tracks.forEach((track, trackIndex) => {
    const trackPath = `tracks[${trackIndex}]`;
    if (!track.id) {
      issues.push(issue('track.missing_id', 'Track is missing an id.', `${trackPath}.id`));
    } else if (trackIds.has(track.id)) {
      issues.push(issue('track.duplicate_id', `Track id "${track.id}" is duplicated.`, `${trackPath}.id`));
    } else {
      trackIds.add(track.id);
    }

    const allowedTypes = track.role ? ROLE_ALLOWED_TYPES[track.role] : undefined;
    const structuralCategories = new Set(track.items.map(itemTrackCategory));
    if (
      !track.category &&
      structuralCategories.size > 1 &&
      inferTrackCategory(track, dsl.primaryTrackId) === null
    ) {
      issues.push(issue(
        'track.mixed_item_categories',
        `Track "${track.id}" mixes incompatible structural item categories.`,
        `${trackPath}.items`,
      ));
    }
    track.items.forEach((item, itemIndex) => {
      const itemPath = `${trackPath}.items[${itemIndex}]`;
      if (!item.id) {
        issues.push(issue('item.missing_id', 'Timeline item is missing an id.', `${itemPath}.id`));
      } else if (itemIds.has(item.id)) {
        issues.push(issue('item.duplicate_id', `Timeline item id "${item.id}" is duplicated.`, `${itemPath}.id`));
      } else {
        itemIds.add(item.id);
      }

      if (!isResolved(item, context)) {
        issues.push(issue('item.unresolved_source', `Timeline item "${item.id}" does not resolve to a known source.`, itemPath));
      }
      if (!Number.isInteger(item.from) || item.from < 0) {
        issues.push(issue('item.invalid_from', 'Timeline item from must be a non-negative integer frame.', `${itemPath}.from`));
      }
      if (!Number.isInteger(item.durationInFrames) || item.durationInFrames <= 0) {
        issues.push(issue('item.invalid_duration', 'Timeline item durationInFrames must be a positive integer.', `${itemPath}.durationInFrames`));
      }
      if (allowedTypes && !allowedTypes.has(item.type)) {
        issues.push(issue('track.role_item_mismatch', `Track role "${track.role}" cannot contain "${item.type}" items.`, itemPath));
      }
      if (track.role === 'subtitle' && !isSubtitleTextItem(item)) {
        issues.push(issue(
          'track.role_item_mismatch',
          'Subtitle tracks require structured text items with cues and source lineage.',
          itemPath,
        ));
      }
      if (track.category && !canTrackAcceptItem(track, item, dsl.primaryTrackId)) {
        issues.push(issue('track.category_item_mismatch', `Track category "${track.category}" cannot contain "${item.type}" items.`, itemPath));
      }
      for (const [effectIndex, effectRef] of (item.effects ?? []).entries()) {
        const effectError = validateEffectRef(effectRef);
        if (effectError) {
          issues.push(issue('item.invalid_effect_ref', effectError, `${itemPath}.effects.${effectIndex}`));
        }
      }
      if (item.type === 'transition') {
        const transition = item as TransitionItem;
        if (!transition.fromItemId || !transition.toItemId) {
          issues.push(issue('item.transition_missing_ref', 'Transition item must reference both source clips.', itemPath));
        } else {
          const boundary = resolveContinuousTransitionBoundary(dsl, transition);
          if (!boundary) {
            issues.push(issue(
              'item.transition_non_continuous',
              'Transition source clips must be visual clips that touch exactly on the same track.',
              itemPath,
            ));
          } else {
            const expectedFrom = boundary.frame - Math.floor(transition.durationInFrames / 2);
            if (transition.from !== expectedFrom) {
              issues.push(issue(
                'item.transition_detached_range',
                `Transition range must stay centered on frame ${boundary.frame}.`,
                `${itemPath}.from`,
              ));
            }
            const maxDurationInFrames = Math.max(
              1,
              Math.min(
                boundary.fromItem.durationInFrames,
                boundary.toItem.durationInFrames,
              ) * 2,
            );
            if (transition.durationInFrames > maxDurationInFrames) {
              issues.push(issue(
                'item.transition_duration_exceeds_handles',
                `Transition duration cannot exceed ${maxDurationInFrames} frames for these clips.`,
                `${itemPath}.durationInFrames`,
              ));
            }
          }
        }
        if (transition.effect) {
          const effectError = validateEffectRef(transition.effect);
          if (effectError) {
            issues.push(issue('item.invalid_effect_ref', effectError, `${itemPath}.effect`));
          }
        }
      }
      if (item.type === 'composition') {
        validateCompositionItem(item as CompositionItem, itemPath, issues);
      }
      if (isSubtitleTextItem(item)) {
        validateCaptionItem(item, itemPath, issues);
      }
      if (item.type === 'derived-overlay') {
        validateDerivedOverlayItem(item as DerivedOverlayItem, itemPath, issues);
      }
    });
  });

  let previousCategoryRank = -1;
  dsl.tracks.forEach((track, trackIndex) => {
    if (!track.category) return;
    const rank = TRACK_CATEGORY_ORDER.indexOf(track.category);
    if (rank < previousCategoryRank) {
      issues.push(issue(
        'track.category_order_mismatch',
        `Track category "${track.category}" is outside the canonical effect, text, visual, primary, audio order.`,
        `tracks[${trackIndex}].category`,
      ));
    }
    previousCategoryRank = Math.max(previousCategoryRank, rank);
  });

  return {
    ok: issues.every((entry) => entry.severity !== 'error'),
    issues,
    durationInFrames: timelineEnd(dsl.tracks),
  };
}

function cloneDsl(dsl: TimelineDsl): TimelineDsl {
  return {
    ...dsl,
    tracks: dsl.tracks.map((track) => ({
      ...track,
      items: track.items.map((item) => ({ ...item }) as Item),
    })),
  };
}

function commandError(dsl: TimelineDsl, code: TimelineIssue['code'], message: string, path: string): TimelineCommandResult {
  return { ok: false, dsl, issues: [issue(code, message, path)] };
}

function makeClip(command: Extract<TimelineCommand, { type: 'add_clip' }>): Item {
  const base = {
    id: command.id ?? `${command.itemType}-${Date.now()}`,
    type: command.itemType,
    from: command.from,
    durationInFrames: command.durationInFrames,
    sourceNodeId: command.sourceNodeId,
    assetId: command.assetId,
    src: '',
  };
  if (command.itemType === 'image') return base as ImageItem;
  if (command.itemType === 'audio') return { ...base, audioGainDb: 0 } as AudioItem;
  if (command.itemType === 'text') {
    return {
      id: base.id,
      type: 'text',
      from: base.from,
      durationInFrames: base.durationInFrames,
      sourceNodeId: base.sourceNodeId,
      assetId: base.assetId,
      text: command.text ?? '',
      color: '#ffffff',
      fontSize: 64,
      fontWeight: 'bold',
    } as TextItem;
  }
  return { ...base, audioGainDb: 0 } as VideoItem;
}

export function applyTimelineCommand(dsl: TimelineDsl, command: TimelineCommand): TimelineCommandResult {
  const next = cloneDsl(dsl);
  const track = next.tracks.find((candidate) => candidate.id === command.trackId);
  if (!track) {
    return commandError(next, 'command.track_not_found', `Track "${command.trackId}" was not found.`, 'trackId');
  }

  if (command.type === 'add_clip') {
    if (command.from < 0 || command.durationInFrames <= 0) {
      return commandError(next, 'command.invalid_input', 'add_clip requires non-negative from and positive durationInFrames.', 'command');
    }
    track.items.push(makeClip(command));
  }

  if (command.type === 'trim_clip') {
    const item = track.items.find((candidate) => candidate.id === command.itemId);
    if (!item) {
      return commandError(next, 'command.item_not_found', `Item "${command.itemId}" was not found.`, 'itemId');
    }
    if (command.from < 0 || command.durationInFrames <= 0) {
      return commandError(next, 'command.invalid_input', 'trim_clip requires non-negative from and positive durationInFrames.', 'command');
    }
    const consumedFrames = command.from - item.from;
    const sourceStartInFrames =
      (item.type === 'video' || item.type === 'audio')
        ? Math.max(0, ((item as VideoItem | AudioItem).sourceStartInFrames ?? 0) + consumedFrames)
        : undefined;
    Object.assign(item, {
      from: command.from,
      durationInFrames: command.durationInFrames,
      ...(sourceStartInFrames === undefined ? {} : { sourceStartInFrames }),
    });
  }

  if (command.type === 'split_clip') {
    const itemIndex = track.items.findIndex((candidate) => candidate.id === command.itemId);
    if (itemIndex < 0) {
      return commandError(next, 'command.item_not_found', `Item "${command.itemId}" was not found.`, 'itemId');
    }
    const item = track.items[itemIndex];
    const end = item.from + item.durationInFrames;
    if (command.splitFrame <= item.from || command.splitFrame >= end) {
      return commandError(next, 'command.invalid_input', 'split_clip splitFrame must be inside the item bounds.', 'splitFrame');
    }
    const consumedFrames = command.splitFrame - item.from;
    const first = { ...item, durationInFrames: consumedFrames } as Item;
    const second = {
      ...item,
      id: `${item.id}-split-${Date.now()}`,
      from: command.splitFrame,
      durationInFrames: end - command.splitFrame,
    } as Item;
    if (item.type === 'video' || item.type === 'audio') {
      (first as VideoItem | AudioItem).sourceStartInFrames = (item as VideoItem | AudioItem).sourceStartInFrames ?? 0;
      (second as VideoItem | AudioItem).sourceStartInFrames =
        ((item as VideoItem | AudioItem).sourceStartInFrames ?? 0) + consumedFrames;
    }
    track.items.splice(itemIndex, 1, first, second);
  }

  next.durationInFrames = timelineEnd(next.tracks);
  const validation = validateTimelineDsl(next);
  return validation.ok ? { ok: true, dsl: next, issues: [] } : { ok: false, dsl: next, issues: validation.issues };
}
