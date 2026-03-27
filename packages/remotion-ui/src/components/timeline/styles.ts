/**
 * Timeline Design System
 * Light theme aligned with main app (white bg, slate borders, red/coral accent)
 */

export const colors = {
  // 背景层次（亮色主题）
  bg: {
    primary: '#ffffff',     // 主背景
    secondary: '#f8fafc',   // 次级背景 (slate-50)
    elevated: '#f1f5f9',    // 悬浮元素 (slate-100)
    hover: '#e2e8f0',       // 悬停状态 (slate-200)
    selected: '#fff1f0',    // 选中状态背景（带品牌色调）
  },

  // 强调色（与主应用品牌色对齐）
  accent: {
    primary: '#FF6B50',     // 主色（品牌红/珊瑚）
    success: '#22c55e',     // 成功（green-500）
    warning: '#f59e0b',     // 警告（amber-500）
    danger: '#ef4444',      // 危险（red-500）
  },

  // 素材类型色（柔和，适配亮色背景）
  item: {
    video: '#6366f1',       // 靛蓝 (indigo-500)
    audio: '#f59e0b',       // 琥珀 (amber-500)
    image: '#a855f7',       // 紫 (purple-500)
    text: '#22c55e',        // 绿 (green-500)
    solid: '#94a3b8',       // 灰 (slate-400)
  },

  // 文字层次
  text: {
    primary: '#0f172a',     // slate-900
    secondary: '#475569',   // slate-600
    tertiary: '#94a3b8',    // slate-400
    disabled: '#cbd5e1',    // slate-300
  },

  // 边框
  border: {
    default: '#e2e8f0',     // slate-200
    active: '#FF6B50',      // 品牌色
    hover: '#cbd5e1',       // slate-300
  },

  // 辅助线和指示器
  guide: {
    snap: '#f59e0b',        // 吸附辅助线（琥珀）
    insert: '#FF6B50',      // 插入指示线（品牌色）
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

export const timeline = {
  headerHeight: 48,
  rulerHeight: 32,
  trackHeight: 72,
  trackLabelWidth: 180,

  itemMinWidth: 30,
  itemVerticalPadding: 6,
  itemBorderRadius: 6,

  playheadWidth: 2,
  playheadTriangleSize: 12,

  zoomMin: 0.25,
  zoomMax: 5,
  zoomDefault: 1,

  snapThreshold: 5,
  snapGridInterval: 5,

  resizeHandleWidth: 8,

  scrollbarThickness: 12,
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 2px 4px rgba(0, 0, 0, 0.08)',
  lg: '0 4px 8px rgba(0, 0, 0, 0.1)',
  selected: `0 0 0 2px #FF6B50, 0 4px 12px rgba(255, 107, 80, 0.2)`,
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

export function getItemColor(type: 'video' | 'audio' | 'image' | 'text' | 'solid', customColor?: string): string {
  if (type === 'solid' && customColor) {
    return customColor;
  }
  return colors.item[type];
}

export function withOpacity(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
