import type {
  AudioItem,
  BaseItem,
  DerivedOverlayItem,
  ImageItem,
  StickerItem,
  TextItem,
  TimelineDsl,
  Track,
  VideoItem,
} from './types';
import type { TIMELINE_DSL_FIELD_ANNOTATIONS } from '@clash/shared-types';

/** Closed audit vocabulary shared by renderer and editor consumer registries. */
export const TIMELINE_FIELD_CONSUMER_KINDS = [
  'rendered',
  'editor',
  'meta',
  'persistence',
  'future',
  'unsupported',
] as const;

export type TimelineFieldConsumerKind = (typeof TIMELINE_FIELD_CONSUMER_KINDS)[number];

export type TimelineFieldConsumerClassification = {
  consumers: readonly [TimelineFieldConsumerKind, ...TimelineFieldConsumerKind[]];
  /** Concrete reason this field is classified this way in the owning package. */
  note: string;
};

export type TimelineRootTrackFieldConsumerRegistry = {
  [Scope in 'root' | 'track']: {
    [Field in keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS[Scope]]:
      TimelineFieldConsumerClassification;
  };
};

export const classifyTimelineField = (
  consumers: readonly [TimelineFieldConsumerKind, ...TimelineFieldConsumerKind[]],
  note: string,
): TimelineFieldConsumerClassification => ({ consumers, note });

const assertNever = (value: never): never => {
  throw new Error(`Unhandled Timeline field consumer kind: ${String(value)}`);
};

export function timelineFieldConsumerKindLabel(kind: TimelineFieldConsumerKind): string {
  switch (kind) {
    case 'rendered': return 'Rendered output';
    case 'editor': return 'Editor surface';
    case 'meta': return 'Runtime metadata';
    case 'persistence': return 'Persistence only';
    case 'future': return 'Reserved for future support';
    case 'unsupported': return 'Explicitly unsupported';
    default: return assertNever(kind);
  }
}

export type TimelineCaptionStyleDefaults = {
  position: NonNullable<NonNullable<TextItem['style']>['position']>;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  lineHeight: number;
};

/**
 * Defaults shown for an absent caption style and used by Remotion output.
 * Keeping this in core prevents the inspector from promising a different look.
 */
export const TIMELINE_CAPTION_STYLE_DEFAULTS = {
  position: 'bottom',
  color: '#ffffff',
  backgroundColor: 'rgba(0,0,0,0.56)',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 52,
  fontWeight: 700,
  lineHeight: 1.18,
} as const satisfies TimelineCaptionStyleDefaults;

type RequiredDefaults<Shape, Keys extends keyof Shape> = {
  [Key in Keys]-?: Exclude<Shape[Key], undefined>;
};

export type TimelineSharedDefaults = {
  root: RequiredDefaults<TimelineDsl,
    | 'compositionWidth'
    | 'compositionHeight'
    | 'fps'
    | 'durationInFrames'
    | 'primaryTrackId'
    | 'assetTranscripts'
    | 'mediaAssetRefs'>;
  track: RequiredDefaults<Track, 'name' | 'hidden' | 'locked'>;
  itemBase: {
    properties: Required<NonNullable<BaseItem['properties']>>;
    effects: NonNullable<BaseItem['effects']>;
  };
  text: RequiredDefaults<TextItem,
    | 'text'
    | 'color'
    | 'fontSize'
    | 'fontFamily'
    | 'fontWeight'
    | 'textAlign'
    | 'letterSpacingPx'
    | 'lineHeight'>;
  video: RequiredDefaults<VideoItem,
    | 'mediaFit'
    | 'sourceStartInFrames'
    | 'audioGainDb'
    | 'videoFadeIn'
    | 'videoFadeOut'
    | 'audioFadeInFrames'
    | 'audioFadeOutFrames'>;
  audio: RequiredDefaults<AudioItem,
    | 'sourceStartInFrames'
    | 'audioGainDb'
    | 'audioFadeInFrames'
    | 'audioFadeOutFrames'>;
  image: RequiredDefaults<ImageItem, 'mediaFit' | 'imageFadeIn' | 'imageFadeOut'>;
  sticker: RequiredDefaults<StickerItem, 'mediaFit'>;
  'derived-overlay': RequiredDefaults<DerivedOverlayItem, 'mediaFit'>;
};

/**
 * Reviewable snapshot of every item-level default in the shared descriptor.
 * The test compares its exact scopes, keys, values, and schemas to annotations,
 * so a new or changed default cannot silently drift into consumer fallbacks.
 */
export const TIMELINE_SHARED_DEFAULTS: TimelineSharedDefaults = {
  root: {
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
    primaryTrackId: null,
    assetTranscripts: {},
    mediaAssetRefs: [],
  },
  track: {
    name: '',
    hidden: false,
    locked: false,
  },
  itemBase: {
    properties: { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 },
    effects: [],
  },
  text: {
    text: '',
    color: '#ffffff',
    fontSize: 60,
    fontFamily: 'Arial',
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacingPx: 0,
    lineHeight: 1.1,
  },
  video: {
    mediaFit: 'fill',
    sourceStartInFrames: 0,
    audioGainDb: 0,
    videoFadeIn: 0,
    videoFadeOut: 0,
    audioFadeInFrames: 0,
    audioFadeOutFrames: 0,
  },
  audio: {
    sourceStartInFrames: 0,
    audioGainDb: 0,
    audioFadeInFrames: 0,
    audioFadeOutFrames: 0,
  },
  image: {
    mediaFit: 'fill',
    imageFadeIn: 0,
    imageFadeOut: 0,
  },
  sticker: {
    mediaFit: 'contain',
  },
  'derived-overlay': {
    mediaFit: 'fill',
  },
};

export const TIMELINE_DEFAULT_CONSUMER_MODES = [
  'shared',
  'schema-normalized',
  'helper',
  'not-read',
  'override',
] as const;

export type TimelineDefaultConsumerMode = (typeof TIMELINE_DEFAULT_CONSUMER_MODES)[number];

export type TimelineDefaultConsumerClassification = {
  mode: TimelineDefaultConsumerMode;
  note: string;
  value?: unknown;
};

export type TimelineDefaultConsumerCoverage<
  Defaults extends Record<string, Record<string, unknown>>,
> = {
  [Scope in keyof Defaults]: {
    [Field in keyof Defaults[Scope]]: TimelineDefaultConsumerClassification;
  };
};

/** Intentional product-level override of the authored DSL's shorter default canvas. */
export const TIMELINE_EDITOR_ROOT_DEFAULT_OVERRIDES = {
  durationInFrames: 1500,
} as const satisfies Partial<TimelineSharedDefaults['root']>;
