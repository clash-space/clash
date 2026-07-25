/**
 * Timeline Design System
 * Warm Canvas theme shared with the project workspace.
 */

export const colors = {
  // Theme-aware surfaces. Fallbacks keep standalone Remotion renders stable.
  bg: {
    primary: 'var(--clash-warm-surface, #fffefd)',
    secondary: 'var(--clash-warm-page, #fbfaf7)',
    elevated: 'var(--clash-warm-surface, #fffefd)',
    hover: 'var(--clash-warm-muted, #f4f1eb)',
    selected: 'var(--clash-brand-light, #fff0ed)',
  },

  // 强调色（与主应用品牌色对齐）
  accent: {
    primary: 'var(--clash-accent, #ff6b50)',
    success: '#22c55e',     // 成功（green-500）
    warning: '#f59e0b',     // 警告（amber-500）
    danger: '#ef4444',      // 危险（red-500）
  },

  // Material colors stay intentionally muted. The playhead/selection owns the
  // coral accent; clips use low-saturation type cues so mixed lanes do not
  // become a wall of competing color.
  item: {
    video: 'var(--clash-timeline-item-video, #cfd9dc)',
    audio: 'var(--clash-timeline-item-audio, #294454)',
    voice: 'var(--clash-timeline-item-audio, #294454)',
    sound: 'var(--clash-timeline-item-audio, #294454)',
    image: 'var(--clash-timeline-item-image, #dec5bd)',
    text: 'var(--clash-timeline-item-text, #e4e2de)',
    effect: 'var(--clash-timeline-item-effect, #d8d2dc)',
    overlay: 'var(--clash-timeline-item-overlay, #dccdd2)',
    solid: 'var(--clash-timeline-item-solid, #d2d6d9)',
  },

  itemText: {
    video: 'var(--clash-timeline-item-video-foreground, #293c42)',
    audio: 'var(--clash-timeline-item-audio-foreground, #f1f4f5)',
    voice: 'var(--clash-timeline-item-audio-foreground, #f1f4f5)',
    sound: 'var(--clash-timeline-item-audio-foreground, #f1f4f5)',
    image: 'var(--clash-timeline-item-image-foreground, #493530)',
    text: 'var(--clash-timeline-item-text-foreground, #343434)',
    effect: 'var(--clash-timeline-item-effect-foreground, #403b44)',
    overlay: 'var(--clash-timeline-item-overlay-foreground, #493b40)',
    solid: 'var(--clash-timeline-item-solid-foreground, #30363a)',
  },

  audio: {
    waveform: 'var(--clash-timeline-audio-waveform, #68858d)',
    fadeEdge: 'var(--clash-timeline-audio-fade-edge, #9bb0b5)',
    fadeMask: 'rgba(0, 0, 0, 0.82)',
    volumeLine: 'rgba(255, 255, 255, 0.92)',
  },

  // 文字层次
  text: {
    primary: 'var(--foreground, #171717)',
    secondary: 'var(--clash-timeline-text-secondary, #57534e)',
    tertiary: 'var(--clash-timeline-text-tertiary, #a8a29e)',
    disabled: 'var(--clash-timeline-text-disabled, #d6d3d1)',
  },

  // 边框
  border: {
    default: 'var(--clash-warm-border, #e1ddd5)',
    subtle: 'var(--clash-timeline-border-subtle, #f0ede7)',
    active: 'var(--clash-accent, #ff6b50)',
    hover: 'var(--canvas-dot, #d6d1c8)',
  },

  // 辅助线和指示器
  guide: {
    snap: '#f59e0b',        // 吸附辅助线（琥珀）
    insert: 'var(--clash-accent, #ff6b50)',
  }
} as const;

export const spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
} as const;

export const borderRadius = {
  sm: 4,
  md: 6,
  lg: 8,
  full: 9999,
} as const;

export const zIndex = {
  base: 1,
  ruler: 10,
  playhead: 20,
  dragging: 30,
  tooltip: 40,
  modal: 50,
} as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", Monaco, Consolas, monospace',
  },
  fontSize: {
    xs: 11,
    sm: 12,
    md: 13,
    lg: 14,
    xl: 16,
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

const PLAYHEAD_TRIANGLE_SIZE = 12;

export const timeline = {
  headerHeight: 44,
  rulerHeight: 28,
  trackHeight: 56,
  trackLabelWidth: 140,
  contentInsetLeft: spacing.xl,
  trackBubbleInset: 4,
  trackBubbleRadius: 10,

  itemMinWidth: 30,
  itemVerticalPadding: 6,
  itemBorderRadius: 8,

  playheadWidth: 2,
  playheadTriangleSize: PLAYHEAD_TRIANGLE_SIZE,

  zoomMin: 0.02,
  zoomMax: 8,
  zoomDefault: 1,

  snapThreshold: 5,
  snapGridInterval: 5,

  resizeHandleWidth: 8,

  scrollbarThickness: 12,
} as const;

export type TimelineTrackCategory = 'effect' | 'text' | 'visual' | 'primary' | 'audio';

export const timelineTrackHeights = {
  effect: 36,
  text: 40,
  visual: timeline.trackHeight,
  primary: 88,
  audio: 48,
} as const satisfies Record<TimelineTrackCategory, number>;

export function getTimelineTrackHeight(category: TimelineTrackCategory | null | undefined): number {
  return category ? timelineTrackHeights[category] : timeline.trackHeight;
}

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 2px 4px rgba(0, 0, 0, 0.08)',
  lg: '0 4px 8px rgba(0, 0, 0, 0.1)',
  trackBubble: 'var(--clash-timeline-track-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.72), 0 3px 9px -6px rgba(74, 60, 47, 0.2))',
  itemRest: 'var(--clash-timeline-item-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 2px 5px rgba(74, 60, 47, 0.12))',
  itemHover: 'var(--clash-timeline-item-hover-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.38), 0 4px 9px rgba(74, 60, 47, 0.16))',
  itemSelected: '0 0 0 2px var(--clash-accent, #ff6b50), inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 5px 12px color-mix(in srgb, var(--clash-accent, #ff6b50) 18%, transparent)',
  selected: '0 0 0 2px var(--clash-accent, #ff6b50), 0 4px 12px color-mix(in srgb, var(--clash-accent, #ff6b50) 20%, transparent)',
  hover: '0 2px 8px rgba(0, 0, 0, 0.08)',
} as const;

export const transitions = {
  fast: 'all 0.15s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
} as const;

export const animations = {
  spring: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
  },
  springGentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 25,
  },
  tween: {
    type: 'tween' as const,
    duration: 0.2,
  },
} as const;

export type TimelineItemVisualType =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'composition'
  | 'derived-overlay'
  | 'sticker'
  | 'transition';

function readableForeground(background: string): string {
  const hex = background.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return colors.itemText.solid;
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = (channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114) / 255;
  return luminance > 0.58 ? '#2f2925' : '#fffefd';
}

export function getTimelineItemTone(
  type: TimelineItemVisualType | string | null | undefined,
  customColor?: string,
): { background: string; foreground: string } {
  if (type === 'solid' && customColor) {
    return { background: customColor, foreground: readableForeground(customColor) };
  }
  switch (type) {
    case 'audio':
      return { background: colors.item.audio, foreground: colors.itemText.audio };
    case 'image':
      return { background: colors.item.image, foreground: colors.itemText.image };
    case 'text':
      return { background: colors.item.text, foreground: colors.itemText.text };
    case 'composition':
    case 'transition':
      return { background: colors.item.effect, foreground: colors.itemText.effect };
    case 'derived-overlay':
    case 'sticker':
      return { background: colors.item.overlay, foreground: colors.itemText.overlay };
    case 'solid':
      return { background: colors.item.solid, foreground: colors.itemText.solid };
    case 'video':
    default:
      return { background: colors.item.video, foreground: colors.itemText.video };
  }
}

export function getItemColor(type: TimelineItemVisualType, customColor?: string): string {
  return getTimelineItemTone(type, customColor).background;
}

export function withOpacity(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
