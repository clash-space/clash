/**
 * Glue layer that lives INSIDE the `<ReactFlow>` element. Responsibilities:
 *   1. Track local mouse position on the canvas and feed it to the
 *      awareness hook in flow coordinates (so peers see the right point
 *      even when their pan/zoom differs).
 *   2. Render the CursorOverlay for incoming peer cursors.
 *
 * Must be mounted as a ReactFlow child to access useReactFlow() — the
 * `screenToFlowPosition` API is the only sanctioned way to translate
 * window pixels into the canvas coordinate space and respects every
 * transform ReactFlow applies (pan, zoom, devicePixelRatio).
 */
import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import CursorOverlay from './CursorOverlay';
import type { Peer } from '@clash/web-ui/hooks/usePresenceAwareness';

interface AwarenessLayerProps {
  peers: Peer[];
  setLocalCursor: (cursor: { x: number; y: number } | null) => void;
}

export default function AwarenessLayer({ peers, setLocalCursor }: AwarenessLayerProps) {
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    // Bind to the document, not the canvas pane. Pane-only binding misses
    // movement over nodes (which stop the event before it reaches the pane),
    // and the result is a cursor that vanishes the moment the user hovers
    // an existing node. Document-level binding keeps peers seeing where the
    // user actually IS, even while interacting.
    const handleMove = (e: MouseEvent) => {
      // Filter out events outside the canvas viewport so the cursor doesn't
      // drift into UI chrome (toolbars, sidebars, modals).
      const flow = document.querySelector('.react-flow');
      if (!flow) return;
      const rect = flow.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        setLocalCursor(null);
        return;
      }
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setLocalCursor({ x: pos.x, y: pos.y });
    };

    const handleLeave = () => setLocalCursor(null);
    const handleBlur = () => setLocalCursor(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('mouseleave', handleLeave);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('mouseleave', handleLeave);
      // Explicit clear on unmount in case the parent re-mounts the layer.
      setLocalCursor(null);
    };
  }, [screenToFlowPosition, setLocalCursor]);

  return <CursorOverlay peers={peers} />;
}
