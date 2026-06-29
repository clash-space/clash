/**
 * CanvasFocusContext — single chokepoint for "pan + center the canvas
 * on a specific node".
 *
 * Use case: anywhere inside the project page (chat bubbles, copilot
 * suggestions, link previews, etc.) can ask the canvas to bring a
 * node into view without knowing anything about React Flow. The chat
 * @-mention thumbnail is the first consumer — clicking the inline
 * chip flies the canvas to that asset.
 *
 * Why a context rather than threading callbacks: the chat panel is a
 * sibling of `<ReactFlow>`, not a descendant, so `useReactFlow()` is
 * unreachable from inside chat code. The context lets a single
 * provider mounted near the ReactFlow root expose `focusNode` for
 * every distant descendant.
 *
 * Outside a provider: `focusNode` is a no-op. Components consuming
 * the hook don't need to guard for "is there a canvas?" — the hook
 * is always safe to call.
 */

import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';

export interface CanvasFocusValue {
  /** Pan + (optionally) zoom the canvas to center on the given node.
   *  No-op if the node isn't on the current canvas — safe to call
   *  from any descendant without checking. */
  focusNode: (nodeId: string, opts?: FocusNodeOptions) => void;
}

export interface FocusNodeOptions {
  /** Target zoom level. Defaults to keeping current zoom unless it's
   *  too far out — in which case we bump to 1.0 so the user can
   *  actually see what landed on. */
  zoom?: number;
  /** Camera ease duration in ms. 0 = jump cut. */
  duration?: number;
  /** Whether to also select the node so its border highlights.
   *  Defaults to true — selection makes the "you arrived here"
   *  feedback unambiguous. */
  select?: boolean;
}

const CanvasFocusContext = createContext<CanvasFocusValue>({
  focusNode: () => {},
});

/**
 * Provider — must be mounted inside a `<ReactFlowProvider>` (or
 * inside a `<ReactFlow>` element, which provides the same context
 * implicitly). Pulls the React Flow instance + current nodes via the
 * `useReactFlow` hook and exposes a stable `focusNode` callback.
 *
 * Mount this near the top of the page that owns the canvas (typically
 * ProjectEditor) so any descendant — including portaled overlays and
 * sibling panels — can call into it.
 */
export function CanvasFocusProvider({ children }: { children: ReactNode }) {
  const rf = useReactFlow();

  const focusNode = useCallback(
    (nodeId: string, opts: FocusNodeOptions = {}) => {
      const node = rf.getNode(nodeId);
      if (!node) return; // unknown id (e.g., a agent mention, or a stale ref) — silent no-op

      // measuredWidth / measuredHeight aren't always populated until a
      // node has rendered once; fall back to its declared dims, then
      // to 0 (treat as a point) so we still center reasonably for
      // brand-new nodes that haven't had a layout pass yet.
      const width = node.measured?.width ?? node.width ?? 0;
      const height = node.measured?.height ?? node.height ?? 0;
      const cx = node.position.x + width / 2;
      const cy = node.position.y + height / 2;

      const currentZoom = rf.getZoom();
      const targetZoom = opts.zoom ?? Math.max(currentZoom, 1);
      const duration = opts.duration ?? 400;

      rf.setCenter(cx, cy, { zoom: targetZoom, duration });

      // Selection is a visual confirm — without it, users sometimes
      // can't tell the camera moved (especially on dense canvases
      // where the target node looks like any other).
      if (opts.select !== false) {
        rf.setNodes((nodes) =>
          nodes.map((n) => ({ ...n, selected: n.id === nodeId })),
        );
      }
    },
    [rf],
  );

  const value = useMemo(() => ({ focusNode }), [focusNode]);
  return <CanvasFocusContext.Provider value={value}>{children}</CanvasFocusContext.Provider>;
}

/** Hook — returns `{ focusNode(id, opts?) }`. Safe outside a provider:
 *  defaults to a no-op so consumers don't need null checks. */
export function useCanvasFocus(): CanvasFocusValue {
  return useContext(CanvasFocusContext);
}
