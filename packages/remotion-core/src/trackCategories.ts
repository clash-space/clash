import {
  TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES,
  TIMELINE_DSL_ROLE_CATEGORIES,
  TIMELINE_DSL_TRACK_CATEGORIES,
} from '@clash/shared-types';
import type { Item, Track, TrackCategory, TrackRole } from './types';

/** Top-to-bottom lane order. The primary lane anchors visuals above audio. */
export const TRACK_CATEGORY_ORDER = [
  ...TIMELINE_DSL_TRACK_CATEGORIES,
] as const satisfies readonly TrackCategory[];

const CATEGORY_RANK = new Map<TrackCategory, number>(
  TRACK_CATEGORY_ORDER.map((category, index) => [category, index]),
);

const ROLE_CATEGORY = Object.fromEntries(
  Object.entries(TIMELINE_DSL_ROLE_CATEGORIES).filter((entry): entry is [TrackRole, TrackCategory] => entry[1] !== null),
) as Partial<Record<TrackRole, TrackCategory>>;

const CATEGORY_ALLOWED_TYPES = Object.fromEntries(
  Object.entries(TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES).map(([category, itemTypes]) => [
    category,
    new Set<Item['type']>(itemTypes),
  ]),
) as unknown as Record<TrackCategory, ReadonlySet<Item['type']>>;

export function itemTrackCategory(item: Pick<Item, 'type'>): Exclude<TrackCategory, 'primary'> {
  switch (item.type) {
    case 'composition':
    case 'transition':
      return 'effect';
    case 'text':
      return 'text';
    case 'audio':
      return 'audio';
    default:
      return 'visual';
  }
}

export function inferTrackCategory(
  track: Track,
  primaryTrackId?: string | null,
): TrackCategory | null {
  if (track.category) return track.category;
  if (primaryTrackId && track.id === primaryTrackId) return 'primary';

  const itemCategories = new Set(track.items.map(itemTrackCategory));
  if (itemCategories.size === 1) return itemCategories.values().next().value ?? null;
  const roleCategory = track.role ? ROLE_CATEGORY[track.role] : undefined;
  if (itemCategories.size > 1) {
    return roleCategory && track.items.every((item) => CATEGORY_ALLOWED_TYPES[roleCategory].has(item.type))
      ? roleCategory
      : null;
  }
  return roleCategory ?? null;
}

export function canTrackAcceptItem(
  track: Track,
  item: Item,
  primaryTrackId?: string | null,
): boolean {
  const category = inferTrackCategory(track, primaryTrackId);
  if (!category) return track.items.length === 0;
  return CATEGORY_ALLOWED_TYPES[category].has(item.type);
}

export function canBePrimaryTrack(track: Track): boolean {
  if (track.category && track.category !== 'primary' && track.category !== 'visual') return false;
  return track.items.every((item) => CATEGORY_ALLOWED_TYPES.primary.has(item.type));
}

export function normalizeTrackCategory(
  track: Track,
  primaryTrackId?: string | null,
): Track {
  const category = inferTrackCategory(track, primaryTrackId);
  return category && track.category !== category ? { ...track, category } : track;
}

export function trackCategoryRank(track: Track, primaryTrackId?: string | null): number {
  const category = inferTrackCategory(track, primaryTrackId);
  // Untyped legacy lanes sit with visual lanes until a first item assigns them.
  return category ? CATEGORY_RANK.get(category) ?? 2 : 2;
}

export function sortTracksByCategory(
  tracks: readonly Track[],
  primaryTrackId?: string | null,
): Track[] {
  return tracks
    .map((track, index) => ({ track, index, rank: trackCategoryRank(track, primaryTrackId) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ track }) => track);
}

export function isTrackCategory(value: unknown): value is TrackCategory {
  return typeof value === 'string' && (TRACK_CATEGORY_ORDER as readonly string[]).includes(value);
}
