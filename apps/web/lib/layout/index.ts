// Re-export everything from shared-layout
export * from '@clash/shared-layout';

// React-specific: LayoutManagerConfig
export type { LayoutManagerConfig } from './types';

// Main hook (React-only, stays in the frontend)
export { useLayoutManager } from './hooks/useLayoutManager';
export type { UseLayoutManagerReturn } from './hooks/useLayoutManager';
