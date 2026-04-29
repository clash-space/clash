// Properties for positioning and transforming items on canvas
export type ItemProperties = {
  x: number; // X position in pixels from canvas center
  y: number; // Y position in pixels from canvas center
  width: number; // Width scale (1 = 100% natural width)
  height: number; // Height scale (1 = 100% natural height)
  rotation?: number; // Rotation in degrees
  opacity?: number; // Opacity (0-1)
  // Note: zIndex is determined by track order, not stored in properties
};

// Base types for timeline items
export type BaseItem = {
  id: string;
  from: number; // Start frame (resolved absolute frame; the canonical value
                // every consumer reads — VideoComposition, render-server, DnD)
  durationInFrames: number;
  /** D1 asset row id, matching canvas node data.assetId. */
  assetId?: string;
  /** Canvas source node id. Legacy DSL stored this value in assetId. */
  sourceNodeId?: string;
  properties?: ItemProperties; // Canvas positioning and transform properties
  /**
   * Original relative-position expression authored by the agent or user via
   * YAML — kept as an opaque memo. The `from` field above is the resolved
   * absolute frame and is what every internal consumer actually reads.
   *
   * Examples (parsed by packages/shared-types/src/timeline-yaml.ts):
   *   "30"          → absolute 30
   *   "prev"        → previous item in the same track + 0
   *   "prev+15"     → previous item's end + 15
   *   "clip-A-30"   → item with id "clip-A" — 30 (overlap)
   *   "start"       → 0
   *
   * Cleared whenever the user moves the item via DnD (the absolute
   * position no longer matches the expression's intent).
   */
  fromExpr?: string;
};

// Different item types
export type SolidItem = BaseItem & {
  type: 'solid';
  color: string;
};

export type TextItem = BaseItem & {
  type: 'text';
  text: string;
  color: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
};

export type VideoItem = BaseItem & {
  type: 'video';
  src: string;
  // Number of frames to skip from the start of the source media
  // when rendering this item (i.e., in-source start offset)
  sourceStartInFrames?: number;
  volume?: number; // Audio volume for video (0-2 range)
  waveform?: number[];
  videoFadeIn?: number; // Video fade in duration in frames
  videoFadeOut?: number; // Video fade out duration in frames
  audioFadeIn?: number; // Audio fade in duration in frames
  audioFadeOut?: number; // Audio fade out duration in frames
  /**
   * Optional CSS color (e.g. "white", "#000"). If set, the videoFadeIn
   * window is rendered as a colored overlay ramping out (the clip emerges
   * FROM that color) instead of opacity-fading the video. Pair with the
   * previous clip's videoFadeOutColor to produce a flash / fade-through-
   * color transition.
   */
  videoFadeInColor?: string;
  /** Mirror of videoFadeInColor for the fade-out window. */
  videoFadeOutColor?: string;
};

export type AudioItem = BaseItem & {
  type: 'audio';
  src: string;
  // Number of frames to skip from the start of the source media
  // when rendering this item (i.e., in-source start offset)
  sourceStartInFrames?: number;
  volume?: number;
  waveform?: number[];
  audioFadeIn?: number; // Audio fade in duration in frames
  audioFadeOut?: number; // Audio fade out duration in frames
};

export type ImageItem = BaseItem & {
  type: 'image';
  src: string;
  /** Image fade-in duration in frames. */
  imageFadeIn?: number;
  /** Image fade-out duration in frames. */
  imageFadeOut?: number;
  /** See VideoItem.videoFadeInColor — same semantics for images. */
  imageFadeInColor?: string;
  /** See VideoItem.videoFadeOutColor — same semantics for images. */
  imageFadeOutColor?: string;
};

export type StickerItem = BaseItem & {
  type: 'sticker';
  // Either animated webp/gif, or an image sequence.
  src: string;
  // Optional sequence metadata for future support
  sequence?: {
    baseUrl: string; // e.g., /frames/frame_####.png
    frameCount: number;
    fps: number;
  };
};

/**
 * Transition between two clips. Sits on the timeline like any other item;
 * during [from, from + durationInFrames) it renders fromItem and toItem
 * simultaneously with a transition effect applied. The referenced items
 * are auto-hidden on their original tracks during the transition window
 * (the renderer wires this up — see VideoComposition).
 *
 * Phase B v1 effects:
 *  - push-left / push-right: translateX both clips
 *  - circle-wipe: animated clip-path circle reveals toItem over fromItem
 *  - crossfade: opacity blend (cleaner alternative to dual fadeIn/fadeOut)
 */
export type TransitionType =
  | 'crossfade'
  | 'push-left'
  | 'push-right'
  | 'slide-up'
  | 'slide-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'circle-wipe'
  | 'zoom-in';

export type TransitionItem = BaseItem & {
  type: 'transition';
  transitionType: TransitionType;
  /** ID of the clip leaving the screen. */
  fromItemId: string;
  /** ID of the clip entering the screen. */
  toItemId: string;
};

export type Item =
  | SolidItem
  | TextItem
  | VideoItem
  | AudioItem
  | ImageItem
  | StickerItem
  | TransitionItem;

// Track definition
export type Track = {
  id: string;
  name: string;
  items: Item[];
  locked?: boolean;
  hidden?: boolean;
};

// Asset types
export type Asset = {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  src: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: string;
  thumbnailFrameCount?: number; // Number of frames in the thumbnail strip
  thumbnailFrameWidth?: number; // Width of each frame in the thumbnail strip (in pixels)
  waveform?: number[]; // Normalized audio peaks (0-1) for waveform visualization
  createdAt: number;
  readOnly?: boolean;
  /** ID of the source node when asset is linked from canvas (for deduplication) */
  sourceNodeId?: string;
  /** Stable D1 asset row id for media identity (thumbnail cache, metadata, etc.) */
  backingAssetId?: string;
};

// Editor state
export type EditorState = {
  tracks: Track[];
  selectedItemId: string | null;
  selectedTrackId: string | null;
  currentFrame: number;
  playing: boolean;
  zoom: number;
  assets: Asset[];
  compositionWidth: number;
  compositionHeight: number;
  fps: number;
  durationInFrames: number;
};

// Editor actions
export type EditorAction =
  | { type: 'ADD_TRACK'; payload: Track }
  | { type: 'INSERT_TRACK'; payload: { track: Track; index: number } }
  | { type: 'REMOVE_TRACK'; payload: string }
  | { type: 'UPDATE_TRACK'; payload: { id: string; updates: Partial<Track> } }
  | { type: 'REORDER_TRACKS'; payload: Track[] }
  | { type: 'ADD_ITEM'; payload: { trackId: string; item: Item } }
  | { type: 'REMOVE_ITEM'; payload: { trackId: string; itemId: string } }
  | { type: 'UPDATE_ITEM'; payload: { trackId: string; itemId: string; updates: Partial<Item> } }
  | { type: 'SPLIT_ITEM'; payload: { trackId: string; itemId: string; splitFrame: number } }
  | { type: 'SELECT_ITEM'; payload: string | null }
  | { type: 'SELECT_TRACK'; payload: string | null }
  | { type: 'SET_CURRENT_FRAME'; payload: number }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'ADD_ASSET'; payload: Asset }
  | { type: 'REMOVE_ASSET'; payload: string }
  | { type: 'SET_COMPOSITION_SIZE'; payload: { width: number; height: number } }
  | { type: 'SET_DURATION'; payload: number };

export type TimelineDsl = Pick<
  EditorState,
  'tracks' | 'compositionWidth' | 'compositionHeight' | 'fps' | 'durationInFrames'
>;
