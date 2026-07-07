import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Audio,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { getItemLookupIds, type Track, type Item } from '@master-clash/remotion-core';

// Debug logging disabled for performance

// ─── Fade math (transitions phase A) ─────────────────────────────────────
// Return a 0-1 multiplier given fade-in/out windows and the current
// SEQUENCE-RELATIVE frame. Duration math uses [visibleFrom, endFrame]
// inclusive (matches the existing video visibility convention).
//
// fadeInFrames > 0  → linear ramp 0 → 1 from visibleFrom .. visibleFrom + N
// fadeOutFrames > 0 → linear ramp 1 → 0 from endFrame - N .. endFrame
// Outside any fade window: returns 1. Both clamped, both can coexist.
export const computeFadeMultiplier = (
  frame: number,
  visibleFrom: number,
  endFrame: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): number => {
  let m = 1;
  if (fadeInFrames > 0) {
    m = Math.min(
      m,
      interpolate(frame, [visibleFrom, visibleFrom + fadeInFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
  }
  if (fadeOutFrames > 0) {
    m = Math.min(
      m,
      interpolate(frame, [endFrame - fadeOutFrames, endFrame], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
  }
  return m;
};

// Color-overlay opacity: the inverse rises during a fade-out (0→1) and
// the inverse falls during a fade-in (1→0). Used when videoFadeIn/OutColor
// is set — instead of fading the video itself we paint a solid color over it.
export const computeColorOverlayOpacity = (
  frame: number,
  visibleFrom: number,
  endFrame: number,
  fadeInFrames: number,
  fadeOutFrames: number,
  hasFadeInColor: boolean,
  hasFadeOutColor: boolean,
): number => {
  let m = 0;
  if (hasFadeInColor && fadeInFrames > 0) {
    m = Math.max(
      m,
      interpolate(frame, [visibleFrom, visibleFrom + fadeInFrames], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
  }
  if (hasFadeOutColor && fadeOutFrames > 0) {
    m = Math.max(
      m,
      interpolate(frame, [endFrame - fadeOutFrames, endFrame], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    );
  }
  return m;
};

// ─── Transitions (phase B) ──────────────────────────────────────────────
// CSS-only transition presentations. Each maps a 0..1 progress to a style
// for the from-side and the to-side. Both sides are rendered in a stacked
// AbsoluteFill; the from-side layer sits on top of the to-side so styles
// like circle-wipe (where from stays in place and we reveal to underneath)
// can be expressed by clipping the to-side layer's reveal mask.
export type TransitionRole = 'from' | 'to';
export type TransitionTypeName =
  | 'crossfade'
  | 'push-left'
  | 'push-right'
  | 'slide-up'
  | 'slide-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'circle-wipe'
  | 'zoom-in';

export const computeTransitionStyle = (
  type: TransitionTypeName,
  progress: number,
  role: TransitionRole,
): React.CSSProperties => {
  const p = Math.min(1, Math.max(0, progress));
  switch (type) {
    case 'crossfade':
      return {
        opacity: role === 'from' ? 1 - p : p,
      };
    case 'push-left':
      return {
        transform: `translateX(${role === 'from' ? -100 * p : 100 * (1 - p)}%)`,
      };
    case 'push-right':
      return {
        transform: `translateX(${role === 'from' ? 100 * p : -100 * (1 - p)}%)`,
      };
    case 'slide-up':
      return {
        transform: `translateY(${role === 'from' ? -100 * p : 100 * (1 - p)}%)`,
      };
    case 'slide-down':
      return {
        transform: `translateY(${role === 'from' ? 100 * p : -100 * (1 - p)}%)`,
      };
    case 'wipe-left': {
      // Reveal to-side via a left-growing rect; from-side stays put underneath.
      if (role === 'from') return {};
      // inset(top right bottom left) — shrink right edge from 100% to 0
      return { clipPath: `inset(0 ${100 - 100 * p}% 0 0)` };
    }
    case 'wipe-right': {
      if (role === 'from') return {};
      return { clipPath: `inset(0 0 0 ${100 - 100 * p}%)` };
    }
    case 'circle-wipe': {
      // Reveal toItem through a growing circle. fromItem stays in place at
      // full opacity below. 71% radius covers the full screen corners
      // (sqrt(50^2 + 50^2) ≈ 70.7).
      if (role === 'from') return {};
      const radius = p * 71;
      return { clipPath: `circle(${radius}% at 50% 50%)` };
    }
    case 'zoom-in': {
      // To-side scales out from a small center while fading in. From-side
      // stays put with mild zoom and fades out.
      if (role === 'from') {
        return { transform: `scale(${1 + 0.15 * p})`, opacity: 1 - p };
      }
      return { transform: `scale(${0.5 + 0.5 * p})`, opacity: p };
    }
  }
};

type RuntimeAnimation = {
  property: 'x' | 'y' | 'opacity' | 'scale' | 'rotation';
  from: number;
  to: number;
  startFrame: number;
  durationInFrames: number;
  easing?: 'linear' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic';
};

type RuntimeCompositionLayer = {
  id: string;
  type: 'text' | 'shape';
  from?: number;
  durationInFrames?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  scale?: number;
  rotation?: number;
  zIndex?: number;
  animations?: RuntimeAnimation[];
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  fill?: string;
  shape?: 'rect' | 'rounded-rect' | 'circle';
  radius?: number;
};

type RuntimeCaptionCue = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  text: string;
};

function applyCompositionEasing(t: number, easing: RuntimeAnimation['easing']): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (easing === 'easeInCubic') return clamped ** 3;
  if (easing === 'easeOutCubic') return 1 - (1 - clamped) ** 3;
  if (easing === 'easeInOutCubic') {
    return clamped < 0.5 ? 4 * clamped ** 3 : 1 - ((-2 * clamped + 2) ** 3) / 2;
  }
  return clamped;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function computeCompositionLayerStyle(
  layer: RuntimeCompositionLayer,
  frame: number,
): React.CSSProperties {
  const style = {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    opacity: layer.opacity ?? 1,
    scale: layer.scale ?? 1,
    rotation: layer.rotation ?? 0,
  };

  for (const animation of layer.animations ?? []) {
    const progress = (frame - animation.startFrame) / animation.durationInFrames;
    if (progress < 0) continue;
    const eased = applyCompositionEasing(progress, animation.easing ?? 'linear');
    style[animation.property] = animation.from + (animation.to - animation.from) * eased;
  }

  const x = rounded(style.x);
  const y = rounded(style.y);
  const scale = rounded(style.scale);
  const rotation = rounded(style.rotation);
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: typeof layer.width === 'number' ? layer.width : undefined,
    height: typeof layer.height === 'number' ? layer.height : undefined,
    opacity: rounded(style.opacity),
    zIndex: layer.zIndex ?? 0,
    transform: `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`,
    transformOrigin: '0 0',
  };
}

export function selectCaptionCueAtFrame(
  cues: RuntimeCaptionCue[] | undefined,
  frame: number,
): RuntimeCaptionCue | null {
  if (!Array.isArray(cues)) return null;
  for (const cue of cues) {
    if (
      Number.isInteger(cue.startFrame) &&
      Number.isInteger(cue.durationInFrames) &&
      frame >= cue.startFrame &&
      frame < cue.startFrame + cue.durationInFrames
    ) {
      return cue;
    }
  }
  return null;
}

type ResolvedTimelineItem = Item & {
  naturalWidth?: number;
  naturalHeight?: number;
  resolvedSrcUrl?: string;
};

export type ObscuredWindow = { from: number; end: number };

/**
 * Pre-scan all tracks to find composition-absolute frame ranges in which
 * each clip is being painted by a transition layer above. The two clips a
 * TransitionItem references (fromItemId / toItemId) get an entry; their
 * track-level renderers consult this map and zero opacity during the
 * window so the transition layer can do the real painting.
 *
 * Pure function — no DOM, no React. Exported for tests and for any future
 * tool that wants to know "what's visible at frame X" without rendering.
 */
export function buildObscuredWindowsByItemId(tracks: Track[]): Map<string, ObscuredWindow[]> {
  const windows = new Map<string, ObscuredWindow[]>();
  const addWin = (id: string, w: ObscuredWindow) => {
    const list = windows.get(id) ?? [];
    list.push(w);
    windows.set(id, list);
  };
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.type !== 'transition') continue;
      const t = item as Item & { fromItemId: string; toItemId: string };
      const win: ObscuredWindow = {
        from: t.from,
        end: t.from + t.durationInFrames - 1,
      };
      if (t.fromItemId) addWin(t.fromItemId, win);
      if (t.toItemId) addWin(t.toItemId, win);
    }
  }
  return windows;
}

/** True iff `compositionFrame` falls inside any of the given windows. */
export function isFrameObscured(
  compositionFrame: number,
  windows: ObscuredWindow[] | undefined,
): boolean {
  if (!windows || windows.length === 0) return false;
  for (const w of windows) {
    if (compositionFrame >= w.from && compositionFrame <= w.end) return true;
  }
  return false;
}

type PreparedSequenceItem = {
  item: ResolvedTimelineItem;
  seqFrom: number;
  visibleFromRel: number;
  endFrameRel: number;
  isGlobalEndItem: boolean;
  /**
   * Composition-absolute frame ranges during which this item should render
   * invisibly (opacity 0) because it is the from/to of an active transition.
   * The transition layer above will paint the actual content with effects.
   */
  obscuredWindows: ObscuredWindow[];
  /**
   * For TransitionItem entries only — pre-resolved references to the from/to
   * clips. Stored here so ItemComponent doesn't need to thread the global map.
   */
  transitionFrom?: ResolvedTimelineItem;
  transitionTo?: ResolvedTimelineItem;
};

type PreparedTrack = {
  id: string;
  hidden?: boolean;
  playbackItems: PreparedSequenceItem[];
};

/**
 * Resolves timeline item references to asset data.
 *
 * Timeline items store sourceNodeId plus, when known, assetId references.
 * This function resolves those references to the actual src/type/dimensions
 * data from asset nodes.
 * This is the frontend equivalent of the backend resolve_item function.
 *
 * @param item Timeline item with potential assetId reference
 * @param allNodesMap Map of all nodes (node ID -> node data)
 * @returns Item with src/type/dimensions resolved from asset node if assetId present
 */
const resolveTimelineItem = (
  item: Item,
  allNodesMap: Map<string, any>,
  srcNodeMap: Map<string, any>,
): ResolvedTimelineItem => {
  let asset = null;

  // 1. Try explicit source node id, then backing asset id, with legacy fallback.
  for (const lookupId of getItemLookupIds(item)) {
    asset = allNodesMap.get(lookupId);
    if (asset) {
      break;
    }
  }

  // 2. If not found by references, try to find by src
  if (!asset && 'src' in item) {
    const itemSrc = (item as any).src;
    asset = srcNodeMap.get(itemSrc) ?? null;
  }

  if (asset) {
    const assetData = asset.data || {};

    // Get natural dimensions from asset node
    let naturalWidth = assetData.naturalWidth;
    let naturalHeight = assetData.naturalHeight;

    // Fallback: parse aspectRatio string (e.g., "16:9") if no natural dimensions
    if ((!naturalWidth || !naturalHeight) && assetData.aspectRatio) {
      const ar = assetData.aspectRatio;
      if (typeof ar === 'string' && ar.includes(':')) {
        const [w, h] = ar.split(':').map(Number);
        if (w && h) {
          // Use 1920 as base width to calculate virtual dimensions
          naturalWidth = 1920;
          naturalHeight = Math.round(1920 * h / w);
        }
      }
    }

    return {
      ...item,
      src: assetData.src || ('src' in item ? item.src : undefined),
      type: item.type,
      naturalWidth,
      naturalHeight,
      resolvedSrcUrl: resolveAssetUrl(assetData.src || ('src' in item ? item.src : undefined)),
    } as ResolvedTimelineItem;
  }

  // Return as-is for non-asset items (solid, text) or if asset not found
  return {
    ...item,
    resolvedSrcUrl: resolveAssetUrl('src' in item ? item.src : undefined),
  };
};

const mergeContiguousMediaItems = (items: ResolvedTimelineItem[]): ResolvedTimelineItem[] => {
  const sorted = [...items].sort((a, b) => a.from - b.from);
  const result: ResolvedTimelineItem[] = [];

  for (const itm of sorted) {
    const last = result[result.length - 1];
    const isMedia = itm.type === 'video' || itm.type === 'audio';
    const lastIsMedia = last && (last.type === 'video' || last.type === 'audio');

    if (
      last &&
      isMedia &&
      lastIsMedia &&
      last.resolvedSrcUrl &&
      itm.resolvedSrcUrl &&
      itm.resolvedSrcUrl === last.resolvedSrcUrl
    ) {
      const lastEnd = last.from + last.durationInFrames;
      const isContiguous = itm.from === lastEnd;
      const lastOffset = (last as any).sourceStartInFrames || 0;
      const currOffset = (itm as any).sourceStartInFrames || 0;
      const offsetContinuous = currOffset === lastOffset + last.durationInFrames;

      if (isContiguous && offsetContinuous) {
        result[result.length - 1] = {
          ...last,
          durationInFrames: last.durationInFrames + itm.durationInFrames,
        };
        continue;
      }
    }

    result.push({ ...itm });
  }

  return result;
};

// Helper to ensure src is a proper URL
const resolveAssetUrl = (src: string | undefined): string => {
  if (!src) return '';

  // Already a full URL
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  // Already a view URL
  if (src.startsWith('/api/assets/view/')) {
    return src;
  }

  // Data URL
  if (src.startsWith('data:')) {
    return src;
  }

  // R2 key format (projects/...) - convert to view URL
  if (src.startsWith('projects/')) {
    return `/api/assets/view/${src}`;
  }

  // Other paths starting with /
  if (src.startsWith('/')) {
    return src;
  }

  // Default: treat as R2 key
  return `/api/assets/view/${src}`;
};

// Component to render individual items.
//
// IMPORTANT: `visibleFrom` and `endFrame` are SEQUENCE-RELATIVE frames (i.e.
// offsets from the enclosing <Sequence from=...>'s start), not composition-
// absolute frames. `useCurrentFrame()` inside a Sequence is sequence-relative
// too, so the comparisons below line up. Mixing the two coord systems was the
// original bug: every item with `item.from > 0` was computing `hidden=true`
// for its entire Sequence and only the outer black-bg wrapper showed.
const ItemComponent: React.FC<{
  item: ResolvedTimelineItem;
  durationInFrames: number;
  visibleFrom?: number;
  endFrame?: number;
  isGlobalEndItem?: boolean;
  trackZIndex: number;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
  /** Sequence-relative offset — needed to convert frame to composition-absolute. */
  seqFrom?: number;
  /** Composition-absolute frame ranges in which this item is hidden by an
   *  active transition layer. Empty = never obscured. */
  obscuredWindows?: ObscuredWindow[];
  /** For TransitionItem only: the resolved from/to clip references. */
  transitionFrom?: ResolvedTimelineItem;
  transitionTo?: ResolvedTimelineItem;
}> = ({ item, durationInFrames: _durationInFrames, visibleFrom, endFrame, isGlobalEndItem, trackZIndex, itemsDomMapRef, seqFrom = 0, obscuredWindows, transitionFrom, transitionTo }) => {
  const frame = useCurrentFrame();
  const { width: compWidth, height: compHeight } = useVideoConfig();
  const resolvedItem = item;

  // Soft-hide while a transition above is painting our content. We just zero
  // opacity (don't unmount) so video startup latency doesn't kick in when
  // the transition window ends and the clip resumes its own track.
  const compositionFrame = frame + seqFrom;
  const isObscured = isFrameObscured(compositionFrame, obscuredWindows);

  // Apply transform properties
  // width and height are scale factors relative to the asset's natural dimensions
  // width=1, height=1 means 100% of the asset's original size (not canvas size)
  const transformStyle = React.useMemo((): React.CSSProperties => {
    const props = resolvedItem.properties;
    if (!props) return { zIndex: trackZIndex };

    // Get natural dimensions from resolved item
    const naturalWidth = resolvedItem.naturalWidth || compWidth;
    const naturalHeight = resolvedItem.naturalHeight || compHeight;

    // Scale relative to natural dimensions
    // props.width/height are multipliers of the asset's natural size
    let widthPx: number;
    let heightPx: number;

    // When both width and height are 1, contain in canvas (preserve aspect ratio)
    if (props.width === 1 && props.height === 1) {
      const scaleX = compWidth / naturalWidth;
      const scaleY = compHeight / naturalHeight;
      const scale = Math.min(scaleX, scaleY);
      widthPx = naturalWidth * scale;
      heightPx = naturalHeight * scale;
    } else {
      // Normal scaling: props.width/height are multipliers of natural dimensions
      widthPx = props.width * naturalWidth;
      heightPx = props.height * naturalHeight;
    }

    const widthPercent = (widthPx / compWidth) * 100;
    const heightPercent = (heightPx / compHeight) * 100;


    // Position from center (x, y in pixels from canvas center)
    const left = `calc(50% + ${props.x}px)`;
    const top = `calc(50% + ${props.y}px)`;

    return {
      position: 'absolute',
      left,
      top,
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      // translate(-50%, -50%) centers the item on the specified position
      transform: `translate(-50%, -50%) rotate(${props.rotation || 0}deg)`,
      opacity: props.opacity ?? 1,
      zIndex: trackZIndex, // Use track-based z-index
    };
  }, [resolvedItem.properties, resolvedItem.naturalWidth, resolvedItem.naturalHeight, compWidth, compHeight, trackZIndex]);

  const applyTransform = React.useCallback(
    (baseStyle: React.CSSProperties = {}): React.CSSProperties => ({
      ...transformStyle,
      ...baseStyle,
    }),
    [transformStyle],
  );

  if (resolvedItem.type === 'solid') {
    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: resolvedItem.color, opacity: isObscured ? 0 : 1 })}
      />
    );
  }

  if (resolvedItem.type === 'text') {
    const fadeOpacity = interpolate(frame, [0, 10], [0, 1], {
      extrapolateRight: 'clamp',
    });

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
          opacity: isObscured ? 0 : fadeOpacity,
        })}
      >
        <h1
          style={{
            color: resolvedItem.color,
            fontSize: resolvedItem.fontSize || 60,
            fontFamily: resolvedItem.fontFamily || 'Arial',
            fontWeight: resolvedItem.fontWeight || 'bold',
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          {resolvedItem.text}
        </h1>
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'caption') {
    const captionItem = resolvedItem as ResolvedTimelineItem & {
      cues?: RuntimeCaptionCue[];
      style?: {
        fontFamily?: string;
        fontSize?: number;
        fontWeight?: string | number;
        color?: string;
        backgroundColor?: string;
        position?: 'bottom' | 'top' | 'center';
      };
    };
    const cue = selectCaptionCueAtFrame(captionItem.cues, frame);
    if (!cue) return null;
    const position = captionItem.style?.position ?? 'bottom';
    const justifyContent =
      position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end';

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        data-caption-item-id={resolvedItem.id}
        style={applyTransform({
          justifyContent,
          alignItems: 'center',
          padding: position === 'bottom' ? '0 72px 96px' : position === 'top' ? '96px 72px 0' : '0 72px',
          pointerEvents: 'none',
          opacity: isObscured ? 0 : 1,
        })}
      >
        <div
          data-caption-cue-id={cue.id}
          style={{
            maxWidth: '92%',
            color: captionItem.style?.color ?? '#ffffff',
            backgroundColor: captionItem.style?.backgroundColor ?? 'rgba(0,0,0,0.56)',
            fontFamily: captionItem.style?.fontFamily ?? 'Inter, system-ui, sans-serif',
            fontSize: captionItem.style?.fontSize ?? 52,
            fontWeight: captionItem.style?.fontWeight ?? 700,
            lineHeight: 1.18,
            textAlign: 'center',
            borderRadius: 16,
            padding: '14px 22px',
            textWrap: 'balance',
            whiteSpace: 'pre-wrap',
          }}
        >
          {cue.text}
        </div>
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'composition') {
    const compositionItem = resolvedItem as ResolvedTimelineItem & {
      runtime?: string;
      compositionKind?: string;
      compositionId?: string;
      renderedAssetPath?: string;
      spec?: { layers?: RuntimeCompositionLayer[] };
    };
    const layers = compositionItem.spec?.layers;
    if (compositionItem.runtime === 'html' && compositionItem.compositionKind === 'motion-graphics' && Array.isArray(layers)) {
      return (
        <AbsoluteFill
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          data-composition-item-id={resolvedItem.id}
          data-composition-id={compositionItem.compositionId}
          data-composition-kind={compositionItem.compositionKind}
          data-composition-runtime={compositionItem.runtime}
          style={applyTransform({ overflow: 'hidden', opacity: isObscured ? 0 : 1 })}
        >
          {layers
            .slice()
            .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
            .map((layer) => {
              const start = layer.from ?? 0;
              const duration = layer.durationInFrames ?? resolvedItem.durationInFrames;
              if (frame < start || frame >= start + duration) return null;
              const layerStyle = computeCompositionLayerStyle(layer, frame);
              if (layer.type === 'shape') {
                const radius = layer.shape === 'circle' ? '9999px' : layer.radius ?? 0;
                return (
                  <div
                    key={layer.id}
                    data-layer-id={layer.id}
                    style={{
                      ...layerStyle,
                      backgroundColor: layer.fill ?? '#ffffff',
                      borderRadius: radius,
                    }}
                  />
                );
              }
              return (
                <div
                  key={layer.id}
                  data-layer-id={layer.id}
                  style={{
                    ...layerStyle,
                    color: layer.color ?? '#ffffff',
                    fontFamily: layer.fontFamily ?? 'Inter, system-ui, sans-serif',
                    fontSize: layer.fontSize ?? 64,
                    fontWeight: layer.fontWeight ?? 700,
                    lineHeight: 1.04,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {layer.text ?? ''}
                </div>
              );
            })}
        </AbsoluteFill>
      );
    }

    if (compositionItem.renderedAssetPath) {
      return (
        <AbsoluteFill
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          data-composition-item-id={resolvedItem.id}
          data-composition-id={compositionItem.compositionId}
          data-composition-kind={compositionItem.compositionKind}
          data-composition-runtime={compositionItem.runtime}
          style={applyTransform({ opacity: isObscured ? 0 : 1 })}
        >
          <OffthreadVideo
            src={resolveAssetUrl(compositionItem.renderedAssetPath)}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
            pauseWhenBuffering={false}
            acceptableTimeShiftInSeconds={0.25}
            muted
            volume={0}
          />
        </AbsoluteFill>
      );
    }
  }

  if (resolvedItem.type === 'derived-overlay') {
    const overlayItem = resolvedItem as ResolvedTimelineItem & {
      mediaType?: 'image' | 'video';
      src?: string;
      sourceAssetId?: string;
      derivedAssetId?: string;
      derivation?: { kind?: string };
    };
    const src = resolveAssetUrl(overlayItem.src);
    if (overlayItem.mediaType === 'image') {
      return (
        <AbsoluteFill
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          data-derived-overlay-item-id={resolvedItem.id}
          data-derived-source-asset-id={overlayItem.sourceAssetId}
          data-derived-asset-id={overlayItem.derivedAssetId}
          data-derived-kind={overlayItem.derivation?.kind}
          style={applyTransform({ opacity: isObscured ? 0 : 1 })}
        >
          <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        </AbsoluteFill>
      );
    }
    if (overlayItem.mediaType === 'video') {
      return (
        <AbsoluteFill
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          data-derived-overlay-item-id={resolvedItem.id}
          data-derived-source-asset-id={overlayItem.sourceAssetId}
          data-derived-asset-id={overlayItem.derivedAssetId}
          data-derived-kind={overlayItem.derivation?.kind}
          style={applyTransform({ opacity: isObscured ? 0 : 1 })}
        >
          <OffthreadVideo
            src={src}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
            pauseWhenBuffering={false}
            acceptableTimeShiftInSeconds={0.25}
            muted
            volume={0}
          />
        </AbsoluteFill>
      );
    }
  }

  if (resolvedItem.type === 'video') {
    const sourceStart = (resolvedItem as any).sourceStartInFrames || 0;
    const isBeforeVisible = typeof visibleFrom === 'number' ? frame < visibleFrom : false;
    const isLastFrameOfItem = typeof endFrame === 'number' ? frame === endFrame : false;
    // Skip the global-end item's last frame guard — that item is supposed to
    // still be visible at the composition's final frame.
    const shouldHideLastFrame = !isGlobalEndItem && isLastFrameOfItem;
    const hidden = isBeforeVisible || shouldHideLastFrame;
    const resolvedSrc = resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src);

    const fadeInFrames = resolvedItem.videoFadeIn ?? 0;
    const fadeOutFrames = resolvedItem.videoFadeOut ?? 0;
    const fadeInColor = (resolvedItem as { videoFadeInColor?: string }).videoFadeInColor;
    const fadeOutColor = (resolvedItem as { videoFadeOutColor?: string }).videoFadeOutColor;
    const vf = visibleFrom ?? 0;
    const ef = endFrame ?? Number.MAX_SAFE_INTEGER;
    // Color set on a side disables opacity fade for that side; an overlay
    // ramps in/out instead. Lets users do white-flash / fade-to-black cleanly.
    const opacityFadeIn = fadeInColor ? 0 : fadeInFrames;
    const opacityFadeOut = fadeOutColor ? 0 : fadeOutFrames;
    const fadeOpacity = computeFadeMultiplier(frame, vf, ef, opacityFadeIn, opacityFadeOut);
    const overlayOpacity = computeColorOverlayOpacity(
      frame,
      vf,
      ef,
      fadeInFrames,
      fadeOutFrames,
      Boolean(fadeInColor),
      Boolean(fadeOutColor),
    );
    // Pick whichever color is active in this frame's window. Fade-in window
    // is at the start; fade-out is at the end — they can't overlap.
    const overlayColor =
      fadeInColor && fadeInFrames > 0 && frame < vf + fadeInFrames
        ? fadeInColor
        : fadeOutColor && fadeOutFrames > 0 && frame > ef - fadeOutFrames
          ? fadeOutColor
          : undefined;
    const audioFadeIn = resolvedItem.audioFadeIn ?? 0;
    const audioFadeOut = resolvedItem.audioFadeOut ?? 0;
    const audioVolumeBase = (resolvedItem as { volume?: number }).volume ?? 1;

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: 'black' })}
      >
        <AbsoluteFill style={{ opacity: hidden || isObscured ? 0 : fadeOpacity, width: '100%', height: '100%' }}>
          <OffthreadVideo
            src={resolvedSrc}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
            startFrom={sourceStart}
            pauseWhenBuffering={false}
            acceptableTimeShiftInSeconds={0.25}
            muted={hidden}
            volume={(f: number) =>
              audioVolumeBase * computeFadeMultiplier(f, vf, ef, audioFadeIn, audioFadeOut)
            }
          />
        </AbsoluteFill>
        {!isObscured && overlayColor && overlayOpacity > 0 && (
          <AbsoluteFill style={{ backgroundColor: overlayColor, opacity: overlayOpacity }} />
        )}
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'audio') {
    const sourceStart = (resolvedItem as any).sourceStartInFrames || 0;
    const baseVolume = resolvedItem.volume || 1;
    const audioFadeIn = resolvedItem.audioFadeIn ?? 0;
    const audioFadeOut = resolvedItem.audioFadeOut ?? 0;
    // Audio items use the Sequence-relative duration as their visible window:
    // visibleFrom = 0, endFrame = durationInFrames - 1. Audio doesn't piggyback
    // on the contiguous-merge offset that video items do.
    const ef = (resolvedItem.durationInFrames ?? 0) - 1;
    return (
      <Audio
        src={resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src)}
        startFrom={sourceStart}
        volume={(f: number) =>
          baseVolume * computeFadeMultiplier(f, 0, ef, audioFadeIn, audioFadeOut)
        }
      />
    );
  }

  if (resolvedItem.type === 'image') {
    const imageItem = resolvedItem as typeof resolvedItem & {
      imageFadeIn?: number;
      imageFadeOut?: number;
      imageFadeInColor?: string;
      imageFadeOutColor?: string;
    };
    const fadeInFrames = imageItem.imageFadeIn ?? 0;
    const fadeOutFrames = imageItem.imageFadeOut ?? 0;
    const fadeInColor = imageItem.imageFadeInColor;
    const fadeOutColor = imageItem.imageFadeOutColor;
    const vf = visibleFrom ?? 0;
    const ef = endFrame ?? (resolvedItem.durationInFrames ?? 0) - 1;
    const opacityFadeIn = fadeInColor ? 0 : fadeInFrames;
    const opacityFadeOut = fadeOutColor ? 0 : fadeOutFrames;
    const fadeOpacity = computeFadeMultiplier(frame, vf, ef, opacityFadeIn, opacityFadeOut);
    const overlayOpacity = computeColorOverlayOpacity(
      frame,
      vf,
      ef,
      fadeInFrames,
      fadeOutFrames,
      Boolean(fadeInColor),
      Boolean(fadeOutColor),
    );
    const overlayColor =
      fadeInColor && fadeInFrames > 0 && frame < vf + fadeInFrames
        ? fadeInColor
        : fadeOutColor && fadeOutFrames > 0 && frame > ef - fadeOutFrames
          ? fadeOutColor
          : undefined;

    return (
      <AbsoluteFill
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
          opacity: isObscured ? 0 : fadeOpacity,
        })}
      >
        <Img
          src={resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src)}
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        />
        {!isObscured && overlayColor && overlayOpacity > 0 && (
          <AbsoluteFill style={{ backgroundColor: overlayColor, opacity: overlayOpacity }} />
        )}
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'transition') {
    const t = resolvedItem as ResolvedTimelineItem & {
      transitionType: TransitionTypeName;
    };
    const dur = Math.max(1, resolvedItem.durationInFrames);
    // Sequence-relative: useCurrentFrame() goes 0..dur-1 inside this Sequence.
    const progress = Math.min(1, Math.max(0, frame / Math.max(1, dur - 1)));
    const fromStyle = computeTransitionStyle(t.transitionType, progress, 'from');
    const toStyle = computeTransitionStyle(t.transitionType, progress, 'to');

    return (
      <AbsoluteFill style={{ zIndex: trackZIndex }}>
        {/* to-side rendered first (under) so circle-wipe etc. read naturally */}
        {transitionTo && (
          <AbsoluteFill style={toStyle}>
            <TransitionContent item={transitionTo} compWidth={compWidth} compHeight={compHeight} />
          </AbsoluteFill>
        )}
        {transitionFrom && (
          <AbsoluteFill style={fromStyle}>
            <TransitionContent item={transitionFrom} compWidth={compWidth} compHeight={compHeight} />
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    );
  }

  return null;
};

/**
 * Stripped-down content-only renderer used inside transitions: no per-item
 * positioning (`properties.x/y/width/height`), no fade fields, no obscured
 * mask — the transition's own wrapper handles all of that.
 */
const TransitionContent: React.FC<{
  item: ResolvedTimelineItem;
  compWidth: number;
  compHeight: number;
}> = ({ item }) => {
  if (item.type === 'video') {
    const sourceStart = (item as { sourceStartInFrames?: number }).sourceStartInFrames || 0;
    const src = item.resolvedSrcUrl || resolveAssetUrl((item as { src?: string }).src);
    return (
      <OffthreadVideo
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        startFrom={sourceStart}
        pauseWhenBuffering={false}
        acceptableTimeShiftInSeconds={0.25}
        muted
        volume={0}
      />
    );
  }
  if (item.type === 'image') {
    const src = item.resolvedSrcUrl || resolveAssetUrl((item as { src?: string }).src);
    return <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />;
  }
  if (item.type === 'solid') {
    return <AbsoluteFill style={{ backgroundColor: (item as { color?: string }).color || '#000' }} />;
  }
  if (item.type === 'text') {
    const t = item as { text: string; color?: string; fontSize?: number; fontFamily?: string; fontWeight?: string };
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h1
          style={{
            color: t.color,
            fontSize: t.fontSize || 60,
            fontFamily: t.fontFamily || 'Arial',
            fontWeight: t.fontWeight || 'bold',
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          {t.text}
        </h1>
      </AbsoluteFill>
    );
  }
  return null;
};

// Component to render a single track
const TrackComponent: React.FC<{
  track: PreparedTrack;
  trackZIndex: number;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = React.memo(({ track, trackZIndex, itemsDomMapRef }) => {
  if (track.hidden) {
    return null;
  }

  const PREMOUNT_FRAMES = 45; // ~1.5秒@30fps，提前挂载以减少边界卡顿

  return (
    <AbsoluteFill>
      {track.playbackItems.map((p) => {
        const { item, seqFrom, visibleFromRel, endFrameRel, isGlobalEndItem, obscuredWindows, transitionFrom, transitionTo } = p;
        return (
          <Sequence key={item.id} from={seqFrom} durationInFrames={item.durationInFrames} premountFor={PREMOUNT_FRAMES}>
            <ItemComponent
              item={item}
              durationInFrames={item.durationInFrames}
              visibleFrom={visibleFromRel}
              endFrame={endFrameRel}
              isGlobalEndItem={isGlobalEndItem}
              trackZIndex={trackZIndex}
              itemsDomMapRef={itemsDomMapRef}
              seqFrom={seqFrom}
              obscuredWindows={obscuredWindows}
              transitionFrom={transitionFrom}
              transitionTo={transitionTo}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
});

// Main composition component
export const VideoComposition: React.FC<{
  tracks: Track[];
  allNodes?: Map<string, any>; // Map of node ID -> node data for resolving assetId references
  selectedItemId?: string | null;
  selectionBoxRef?: React.RefObject<HTMLDivElement | null>;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = ({ tracks, allNodes, selectedItemId, selectionBoxRef, itemsDomMapRef }) => {
  const { width: compWidth, height: compHeight } = useVideoConfig();

  // Create empty nodes map if not provided (for backward compatibility)
  const nodesMap = React.useMemo(() => allNodes || new Map(), [allNodes]);
  const srcNodeMap = React.useMemo(() => {
    const next = new Map<string, any>();
    for (const [, node] of nodesMap.entries()) {
      const src = node?.data?.src;
      if (src) {
        next.set(src, node);
      }
    }
    return next;
  }, [nodesMap]);

  // 计算全局最后一帧（与上面的 TrackComponent 用到的 globalEndFrame 保持一致）
  const globalEndFrame = React.useMemo(() => {
    let maxEnd = 0;
    for (const t of tracks) {
      for (const itm of t.items) {
        const end = itm.from + itm.durationInFrames - 1;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }, [tracks]);

  // Phase B: scan all tracks once for transitions. Two outputs:
  //   1. globalResolvedItems — itemId → resolved item (for transition refs that
  //      may live on a different track than the transition itself).
  //   2. obscuredWindowsByItemId — composition-absolute frame ranges during
  //      which a clip is being painted by a transition layer and must render
  //      invisibly on its own track.
  // The window math is pulled out into buildObscuredWindowsByItemId for tests.
  const globalResolvedItems = React.useMemo(() => {
    const resolved = new Map<string, ResolvedTimelineItem>();
    for (const track of tracks) {
      for (const item of track.items) {
        resolved.set(item.id, resolveTimelineItem(item, nodesMap, srcNodeMap));
      }
    }
    return resolved;
  }, [tracks, nodesMap, srcNodeMap]);
  const obscuredWindowsByItemId = React.useMemo(
    () => buildObscuredWindowsByItemId(tracks),
    [tracks],
  );

  const preparedTracks = React.useMemo<PreparedTrack[]>(() => {
    return tracks.map((track) => {
      const resolvedItems = track.items.map((item) => resolveTimelineItem(item, nodesMap, srcNodeMap));
      const mergedItems = mergeContiguousMediaItems(resolvedItems);
      const playbackItems = mergedItems.map((item, idx) => {
        const prev = idx > 0 ? mergedItems[idx - 1] : undefined;
        const isPrevContiguous =
          !!prev &&
          prev.type === item.type &&
          !!prev.resolvedSrcUrl &&
          !!item.resolvedSrcUrl &&
          prev.resolvedSrcUrl === item.resolvedSrcUrl &&
          prev.from + prev.durationInFrames === item.from &&
          (((prev as any).sourceStartInFrames || 0) + prev.durationInFrames === ((item as any).sourceStartInFrames || 0));

        const seqFrom = isPrevContiguous ? Math.max(0, item.from - 1) : item.from;
        const visibleFromRel = item.from - seqFrom;
        const endFrameRel = (item.from + item.durationInFrames - 1) - seqFrom;
        const isGlobalEndItem = item.from + item.durationInFrames - 1 === globalEndFrame;

        const obscuredWindows = obscuredWindowsByItemId.get(item.id) ?? [];

        let transitionFrom: ResolvedTimelineItem | undefined;
        let transitionTo: ResolvedTimelineItem | undefined;
        if (item.type === 'transition') {
          const t = item as ResolvedTimelineItem & {
            fromItemId: string;
            toItemId: string;
          };
          transitionFrom = globalResolvedItems.get(t.fromItemId);
          transitionTo = globalResolvedItems.get(t.toItemId);
        }

        return {
          item,
          seqFrom,
          visibleFromRel,
          endFrameRel,
          isGlobalEndItem,
          obscuredWindows,
          transitionFrom,
          transitionTo,
        };
      });

      return {
        id: track.id,
        hidden: track.hidden,
        playbackItems,
      };
    });
  }, [tracks, nodesMap, srcNodeMap, globalEndFrame, obscuredWindowsByItemId, globalResolvedItems]);

  // 找到选中的 item 和它的 properties，同时解析 natural dimensions
  const selectedItemResolved = React.useMemo(() => {
    if (!selectedItemId) return null;
    for (const track of preparedTracks) {
      const matched = track.playbackItems.find(({ item }) => item.id === selectedItemId);
      if (matched) {
        return matched.item;
      }
    }
    return null;
  }, [preparedTracks, selectedItemId]);

  // Calculate selection box dimensions using the same logic as applyTransform
  const selectionBoxStyle = React.useMemo(() => {
    if (!selectedItemResolved?.properties) return null;

    const props = selectedItemResolved.properties;
    const naturalWidth = (selectedItemResolved as any).naturalWidth || compWidth;
    const naturalHeight = (selectedItemResolved as any).naturalHeight || compHeight;

    // Scale relative to natural dimensions
    // props.width/height are multipliers of the asset's natural size
    let widthPx: number;
    let heightPx: number;

    // When both width and height are 1, contain in canvas (preserve aspect ratio)
    if (props.width === 1 && props.height === 1) {
      const scaleX = compWidth / naturalWidth;
      const scaleY = compHeight / naturalHeight;
      const scale = Math.min(scaleX, scaleY);
      widthPx = naturalWidth * scale;
      heightPx = naturalHeight * scale;
    } else {
      // Normal scaling: props.width/height are multipliers of natural dimensions
      widthPx = props.width * naturalWidth;
      heightPx = props.height * naturalHeight;
    }

    const widthPercent = (widthPx / compWidth) * 100;
    const heightPercent = (heightPx / compHeight) * 100;

    return {
      position: 'absolute' as const,
      left: `calc(50% + ${props.x}px)`,
      top: `calc(50% + ${props.y}px)`,
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      transform: `translate(-50%, -50%)`,
      boxSizing: 'border-box' as const,
    };
  }, [selectedItemResolved, compWidth, compHeight]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black', top: 0, left: 0, right: 0, bottom: 0 }}>
      {preparedTracks.map((track, trackIndex) => {
        // Track 0 (first/top) should have highest z-index
        // Higher index = lower in timeline = lower z-index
        const trackZIndex = preparedTracks.length - trackIndex;
        return (
          <TrackComponent key={`${track.id}-${trackIndex}`} track={track} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
        );
      })}

      {/* 选择框 - 透明的，只用于提供 ref（不包含旋转） */}
      {selectedItemResolved && selectionBoxStyle && (
        <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 9999 }}>
          <div
            ref={selectionBoxRef}
            style={selectionBoxStyle}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
