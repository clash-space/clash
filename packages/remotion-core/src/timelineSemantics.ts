import type {
  AudioItem,
  ImageItem,
  Item,
  TimelineDsl,
  Track,
  TextItem,
  VideoItem,
} from './types';
import {
  validateTimelineDsl as validateCanonicalTimelineDsl,
  type TimelineDslValidationIssue as CanonicalTimelineIssue,
} from '@clash/shared-types';
import { isSubtitleTextItem } from './types';

export type { TimelineDsl, TrackRole } from './types';

export type TimelineIssueSeverity = 'error' | 'warning';

export type TimelineIssue = {
  severity: TimelineIssueSeverity;
  /** Canonical @clash/shared-types rule id when this issue comes from the public DSL contract. */
  ruleId?: string;
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

function issue(
  code: TimelineIssue['code'],
  message: string,
  path: string,
  ruleId?: string,
): TimelineIssue {
  return { severity: 'error', code, message, path, ...(ruleId ? { ruleId } : {}) };
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

const CANONICAL_RULE_TO_LEGACY_CODE: Readonly<Record<string, TimelineIssue['code']>> = {
  'timeline.track.duplicate-id': 'track.duplicate_id',
  'timeline.item.duplicate-id': 'item.duplicate_id',
  'timeline.track.category-item-mismatch': 'track.category_item_mismatch',
  'timeline.track.role-item-mismatch': 'track.role_item_mismatch',
  'timeline.track.category-order': 'track.category_order_mismatch',
  'timeline.track.mixed-categories': 'track.mixed_item_categories',
  'timeline.item.from-expression': 'item.invalid_from',
  'timeline.item.frame-integer': 'item.invalid_from',
  'timeline.item.from-reference': 'item.invalid_from',
  'timeline.item.from-cycle': 'item.invalid_from',
  'timeline.item.source-required': 'item.unresolved_source',
  'timeline.audio.ducking-track-role': 'track.role_item_mismatch',
  'timeline.composition.local-path': 'item.invalid_composition',
  'timeline.composition.preview-contract': 'item.invalid_composition',
  'timeline.caption.lineage': 'item.invalid_caption',
  'timeline.derived-overlay.local-path': 'item.invalid_derived_overlay',
  'timeline.derived-overlay.copy-on-write': 'item.invalid_derived_overlay',
  'timeline.transition.reference': 'item.transition_missing_ref',
  'timeline.transition.continuity': 'item.transition_non_continuous',
  'timeline.transition.centered-range': 'item.transition_detached_range',
  'timeline.transition.duration-handles': 'item.transition_duration_exceeds_handles',
};

function formatCanonicalPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    return formatted ? `${formatted}.${segment}` : segment;
  }, '');
}

function itemAtCanonicalPath(
  dsl: TimelineDsl,
  path: readonly (string | number)[],
): Item | undefined {
  if (path[0] !== 'tracks' || typeof path[1] !== 'number') return undefined;
  if (path[2] !== 'items' || typeof path[3] !== 'number') return undefined;
  return dsl.tracks[path[1]]?.items[path[3]];
}

function structuralLegacyCode(
  dsl: TimelineDsl,
  canonical: CanonicalTimelineIssue,
): TimelineIssue['code'] {
  const { path } = canonical;
  if (path[0] === 'fps') return 'timeline.invalid_fps';
  if (path[0] === 'compositionWidth' || path[0] === 'compositionHeight') {
    return 'timeline.invalid_size';
  }
  if (path[0] === 'tracks' && typeof path[1] === 'number' && path[2] === 'id') {
    return 'track.missing_id';
  }
  if (path[0] === 'tracks' && typeof path[1] === 'number' && path[2] === 'role') {
    return 'track.role_item_mismatch';
  }
  if (path[0] === 'tracks' && typeof path[1] === 'number' && path[2] === 'category') {
    return 'track.category_item_mismatch';
  }

  const item = itemAtCanonicalPath(dsl, path);
  if (!item) return 'command.invalid_input';
  const itemField = path[4];
  if (itemField === 'id') return 'item.missing_id';
  if (itemField === 'from') return 'item.invalid_from';
  if (itemField === 'durationInFrames') return 'item.invalid_duration';
  if (itemField === 'effects' || itemField === 'effect') return 'item.invalid_effect_ref';
  if (item.type === 'composition') return 'item.invalid_composition';
  if (item.type === 'derived-overlay') return 'item.invalid_derived_overlay';
  if (item.type === 'transition' && (itemField === 'fromItemId' || itemField === 'toItemId')) {
    return 'item.transition_missing_ref';
  }
  if (
    item.type === 'text'
    && ['cues', 'wordRefs', 'sourceToOutputMap'].includes(String(itemField))
  ) {
    return 'item.invalid_caption';
  }
  return 'command.invalid_input';
}

function legacyCodeForCanonicalIssue(
  dsl: TimelineDsl,
  canonical: CanonicalTimelineIssue,
): TimelineIssue['code'] {
  if (canonical.ruleId === 'timeline.caption.structured') {
    const item = itemAtCanonicalPath(dsl, canonical.path);
    return item && !isSubtitleTextItem(item)
      ? 'track.role_item_mismatch'
      : 'item.invalid_caption';
  }
  return CANONICAL_RULE_TO_LEGACY_CODE[canonical.ruleId]
    ?? structuralLegacyCode(dsl, canonical);
}

function legacyPathForCanonicalIssue(
  dsl: TimelineDsl,
  canonical: CanonicalTimelineIssue,
  code: TimelineIssue['code'],
): string {
  const path = formatCanonicalPath(canonical.path);
  const item = itemAtCanonicalPath(dsl, canonical.path);
  if (
    code === 'item.invalid_derived_overlay'
    && canonical.ruleId === 'timeline.derived-overlay.copy-on-write'
    && item?.type === 'derived-overlay'
    && item.assetId
    && item.assetId !== item.derivedAssetId
  ) {
    return `${path}.assetId`;
  }
  return path;
}

function canonicalIssueDedupeKey(
  canonical: CanonicalTimelineIssue,
  code: TimelineIssue['code'],
): string {
  if (code !== 'item.invalid_effect_ref') {
    return `${canonical.ruleId}:${formatCanonicalPath(canonical.path)}`;
  }
  const effectsIndex = canonical.path.indexOf('effects');
  if (effectsIndex >= 0) {
    return `${code}:${formatCanonicalPath(canonical.path.slice(0, effectsIndex + 2))}`;
  }
  const effectIndex = canonical.path.indexOf('effect');
  return `${code}:${formatCanonicalPath(
    effectIndex >= 0 ? canonical.path.slice(0, effectIndex + 1) : canonical.path,
  )}`;
}

function canonicalTimelineIssues(dsl: TimelineDsl): TimelineIssue[] {
  const validation = validateCanonicalTimelineDsl(dsl);
  if (validation.ok) return [];
  const seen = new Set<string>();
  const issues: TimelineIssue[] = [];
  for (const canonical of validation.issues) {
    const code = legacyCodeForCanonicalIssue(dsl, canonical);
    const dedupeKey = canonicalIssueDedupeKey(canonical, code);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    issues.push(issue(
      code,
      canonical.message,
      legacyPathForCanonicalIssue(dsl, canonical, code),
      canonical.ruleId,
    ));
  }
  return issues;
}

function appendContextResolutionIssues(
  dsl: TimelineDsl,
  context: TimelineValidationContext,
  issues: TimelineIssue[],
): void {
  if (!context.resolvableSourceNodeIds && !context.resolvableAssetIds) return;
  dsl.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      const hasDeclaredSource = Boolean(
        itemSourceNodeId(item)
        || itemAssetId(item)
        || ('src' in item && typeof item.src === 'string' && item.src.trim()),
      );
      if (!hasDeclaredSource) return;
      if (isResolved(item, context)) return;
      issues.push(issue(
        'item.unresolved_source',
        `Timeline item "${item.id}" does not resolve to a known source.`,
        `tracks[${trackIndex}].items[${itemIndex}]`,
      ));
    });
  });
}

export function validateTimelineDsl(
  dsl: TimelineDsl,
  context: TimelineValidationContext = {},
): TimelineValidationResult {
  const issues: TimelineIssue[] = [];
  appendContextResolutionIssues(dsl, context, issues);
  issues.push(...canonicalTimelineIssues(dsl));
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

function unhandledTimelineCommand(command: never): never {
  const type = (command as { type?: unknown }).type;
  throw new Error(`Unhandled Timeline semantic command: ${String(type)}`);
}

function makeClip(command: Extract<TimelineCommand, { type: 'add_clip' }>): Item {
  const base = {
    id: command.id ?? `${command.itemType}-${Date.now()}`,
    type: command.itemType,
    from: command.from,
    durationInFrames: command.durationInFrames,
    sourceNodeId: command.sourceNodeId,
    assetId: command.assetId,
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

  switch (command.type) {
    case 'add_clip': {
      if (command.from < 0 || command.durationInFrames <= 0) {
        return commandError(next, 'command.invalid_input', 'add_clip requires non-negative from and positive durationInFrames.', 'command');
      }
      track.items.push(makeClip(command));
      break;
    }
    case 'trim_clip': {
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
      break;
    }
    case 'split_clip': {
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
      break;
    }
    default:
      return unhandledTimelineCommand(command);
  }

  next.durationInFrames = timelineEnd(next.tracks);
  const validation = validateTimelineDsl(next);
  return validation.ok ? { ok: true, dsl: next, issues: [] } : { ok: false, dsl: next, issues: validation.issues };
}
