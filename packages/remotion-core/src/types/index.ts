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
  from: number; // Start frame
  durationInFrames: number;
  assetId?: string;
  properties?: ItemProperties; // Canvas positioning and transform properties
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

export type Item = SolidItem | TextItem | VideoItem | AudioItem | ImageItem | StickerItem;

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
