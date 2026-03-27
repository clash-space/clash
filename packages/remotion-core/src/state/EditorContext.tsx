import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type { EditorState, EditorAction, Item } from '../types';

// Initial state
const initialState: EditorState = {
  tracks: [],
  selectedItemId: null,
  selectedTrackId: null,
  currentFrame: 0,
  playing: false,
  zoom: 1,
  assets: [],
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 1500, // 50 seconds at 30fps
};

// Reducer function
function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_TRACK':
      return {
        ...state,
        tracks: [...state.tracks, action.payload],
      };

    case 'INSERT_TRACK': {
      const newTracks = [...state.tracks];
      const { track, index } = action.payload;

      // Insert at specific index
      newTracks.splice(index, 0, track);


      return {
        ...state,
        tracks: newTracks,
      };
    }

    case 'REMOVE_TRACK':
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.payload),
        selectedTrackId: state.selectedTrackId === action.payload ? null : state.selectedTrackId,
      };

    case 'UPDATE_TRACK':
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.updates } : t
        ),
      };

    case 'REORDER_TRACKS':
      return {
        ...state,
        tracks: action.payload,
      };

    case 'ADD_ITEM':
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.trackId
            ? { ...t, items: [...t.items, action.payload.item] }
            : t
        ),
      };

    case 'REMOVE_ITEM': {
      // Remove the item first
      const tracksAfterRemoval = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? { ...t, items: t.items.filter((i) => i.id !== action.payload.itemId) }
          : t
      );

      // Auto-delete empty tracks
      const finalTracks = tracksAfterRemoval.filter((t) => t.items.length > 0);

      return {
        ...state,
        tracks: finalTracks,
        selectedItemId: state.selectedItemId === action.payload.itemId ? null : state.selectedItemId,
      };
    }

    case 'UPDATE_ITEM':
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.trackId
            ? {
                ...t,
                items: t.items.map((i) =>
                  i.id === action.payload.itemId ? ({ ...i, ...action.payload.updates } as Item) : i
                ),
              }
            : t
        ),
      };

    case 'SPLIT_ITEM': {
      const { trackId, itemId, splitFrame } = action.payload;

      return {
        ...state,
        tracks: state.tracks.map((t) => {
          if (t.id !== trackId) return t;

          const newItems = t.items.flatMap((item) => {
            if (item.id !== itemId) return [item];


            // Check if split frame is within item bounds
            const itemEnd = item.from + item.durationInFrames;

            if (splitFrame <= item.from || splitFrame >= itemEnd) {
              console.warn('⚠️ Split frame out of bounds, keeping original item');
              return [item];
            }

            // Step 1: Copy - 创建副本并修改 ID
            const cleanBase = (it: any) => {
              const clone = { ...it };
              delete clone.sourceMinStartInFrames;
              delete clone.sourceMaxEndInFrames;
              delete clone.justInserted;
              return clone;
            };

            const secondItem: any = {
              ...cleanBase(item),
              id: `${item.id}-split-${Date.now()}`,
            };

            // Step 2: 第一个 item - 保留前半部分
            const firstDuration = splitFrame - item.from;
            const currentOffset = (item as any).sourceStartInFrames || 0;

            const firstItem: any = {
              ...cleanBase(item),
              durationInFrames: firstDuration,
              // 保持原始的 sourceStartInFrames，不添加任何人工锁
              // 素材的天然边界会自动限制扩展范围
              ...(item.type === 'video' || item.type === 'audio'
                ? {
                    sourceStartInFrames: currentOffset,
                  }
                : {}),
            };

            // Step 3: 第二个 item - 保留后半部分
            const secondDuration = itemEnd - splitFrame;
            const consumedFrames = splitFrame - item.from;
            const newSourceOffset = currentOffset + consumedFrames;

            Object.assign(secondItem, {
              from: splitFrame,
              durationInFrames: secondDuration,
              // 设置新的 sourceStartInFrames 到 split 点，不添加任何人工锁
              // 素材的天然边界会自动限制扩展范围
              ...(item.type === 'video' || item.type === 'audio'
                ? {
                    sourceStartInFrames: newSourceOffset,
                  }
                : {}),
              // Mark as justInserted so TimelineItem will regenerate thumbnail
              justInserted: item.type === 'video',
            });

            return [firstItem as Item, secondItem as Item];
          });

          return { ...t, items: newItems };
        }),
      };
    }

    case 'SELECT_ITEM':
      return { ...state, selectedItemId: action.payload };

    case 'SELECT_TRACK':
      return { ...state, selectedTrackId: action.payload };

    case 'SET_CURRENT_FRAME':
      return { ...state, currentFrame: action.payload };

    case 'SET_PLAYING':
      return { ...state, playing: action.payload };

    case 'SET_ZOOM':
      return { ...state, zoom: action.payload };

    case 'ADD_ASSET':
      return {
        ...state,
        assets: [...state.assets, action.payload],
      };

    case 'REMOVE_ASSET':
      return {
        ...state,
        assets: state.assets.filter((a) => a.id !== action.payload),
      };

    case 'SET_COMPOSITION_SIZE':
      return {
        ...state,
        compositionWidth: action.payload.width,
        compositionHeight: action.payload.height,
      };

    case 'SET_DURATION':
      return { ...state, durationInFrames: action.payload };

    default:
      return state;
  }
}

// Context
type EditorContextType = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
};

const EditorContext = createContext<EditorContextType | undefined>(undefined);

// Default state for normalization
const defaultState = initialState;

// Normalize initial state by merging with defaults
function normalizeInitialState(providedState?: Partial<EditorState>): EditorState {
  if (!providedState) return defaultState;
  // Filter out undefined values to prevent overwriting defaults
  const filteredState = Object.fromEntries(
    Object.entries(providedState).filter(([_, value]) => value !== undefined)
  ) as Partial<EditorState>;
  const merged = { ...defaultState, ...filteredState };

  if (!merged.fps || merged.fps < 1) {
    merged.fps = defaultState.fps;
  }

  if (!merged.durationInFrames || merged.durationInFrames < 1) {
    let maxEnd = 0;
    for (const track of merged.tracks) {
      for (const item of track.items) {
        const end = item.from + item.durationInFrames;
        if (end > maxEnd) maxEnd = end;
      }
    }
    merged.durationInFrames = maxEnd > 0 ? maxEnd : defaultState.durationInFrames;
  }

  return merged;
}

type EditorProviderProps = {
  children: ReactNode;
  initialState?: Partial<EditorState>;
  onStateChange?: (state: EditorState) => void;
};

// Provider
export function EditorProvider({ children, initialState: providedInitialState, onStateChange }: EditorProviderProps) {
  const [state, dispatch] = useReducer(
    editorReducer,
    providedInitialState,
    (init) => normalizeInitialState(init)
  );

  // Legacy onStateChange support - prefer using stateRef in Editor component instead
  // This still has some overhead, but much less than before (only runs on persistable changes)
  const prevPersistableRef = React.useRef<string | null>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const { tracks, compositionWidth, compositionHeight, fps, durationInFrames, assets, zoom } = state;

  React.useEffect(() => {
    if (!onStateChange) return;

    const persistableJson = JSON.stringify({ tracks, compositionWidth, compositionHeight, fps, durationInFrames, assets, zoom });
    if (prevPersistableRef.current !== persistableJson) {
      prevPersistableRef.current = persistableJson;
      onStateChange(stateRef.current);
    }
  }, [onStateChange, tracks, compositionWidth, compositionHeight, fps, durationInFrames, assets, zoom]);

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      {children}
    </EditorContext.Provider>
  );
}

// Hook
export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within EditorProvider');
  }
  return context;
}
