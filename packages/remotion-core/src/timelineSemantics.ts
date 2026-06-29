import type {
  AudioItem,
  ImageItem,
  Item,
  TimelineDsl,
  Track,
  TrackRole,
  TransitionItem,
  VideoItem,
} from './types';

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
    | 'item.duplicate_id'
    | 'item.missing_id'
    | 'item.invalid_from'
    | 'item.invalid_duration'
    | 'item.unresolved_source'
    | 'item.transition_missing_ref'
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
      itemType: 'video' | 'audio' | 'image';
      from: number;
      durationInFrames: number;
      id?: string;
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
  overlay: new Set(['video', 'image', 'solid', 'text', 'sticker']),
  subtitle: new Set(['text']),
  narration: new Set(['audio', 'video']),
  music: new Set(['audio']),
  sfx: new Set(['audio']),
  transition: new Set(['transition']),
  mixed: new Set(['video', 'audio', 'image', 'solid', 'text', 'sticker', 'transition']),
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
      if (item.type === 'transition') {
        const transition = item as TransitionItem;
        if (!transition.fromItemId || !transition.toItemId) {
          issues.push(issue('item.transition_missing_ref', 'Transition item must reference both source clips.', itemPath));
        }
      }
    });
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
  if (command.itemType === 'audio') return { ...base, volume: 1 } as AudioItem;
  return { ...base, volume: 1 } as VideoItem;
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
