/**
 * Renders peer cursors + name labels on top of the ReactFlow canvas.
 *
 * MUST be mounted as a child of `<ReactFlow>` so `useViewport` resolves
 * the current pan/zoom. The cursors are positioned in flow-coordinate
 * space (peers send their pointer position pre-transformed to flow
 * coords, so pan/zoom on our side keeps relative positions stable).
 *
 * z-index: above nodes (which top out at ~CHILD_NODE_Z_INDEX_BASE+depth
 * in ProjectEditor) but below the toolbar/header chrome (z-10..z-50).
 * We pick the z-10..z-20 band and inline z-index because we're rendering
 * an absolutely-positioned layer inside ReactFlow's coordinate system.
 */
import { memo } from 'react';
import { useViewport } from '@xyflow/react';
import type { Peer } from '@clash/web-ui/hooks/usePresenceAwareness';

interface CursorOverlayProps {
  peers: Peer[];
}

function CursorOverlayImpl({ peers }: CursorOverlayProps) {
  const { x: vx, y: vy, zoom } = useViewport();

  return (
    <div
      // pointer-events-none so peer cursors never block local interaction.
      // Inset 0 + overflow visible lets cursors at the edge render past
      // the canvas without being clipped by an intermediate container.
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ zIndex: 15 }}
      aria-hidden
    >
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        // Flow → screen: same affine ReactFlow uses internally.
        const screenX = peer.cursor.x * zoom + vx;
        const screenY = peer.cursor.y * zoom + vy;
        return (
          <div
            key={peer.userId}
            className="absolute"
            // CSS transition smooths the gap between throttled updates
            // (server fans at 12Hz; without easing the cursor would step).
            // `linear` matches mouse intuition better than the default
            // `ease` curve, which lags noticeably during continuous motion.
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
              transition: 'transform 80ms linear',
              willChange: 'transform',
            }}
          >
            {/* SVG cursor arrow — outlined for legibility on busy backdrops. */}
            <svg
              width={20}
              height={20}
              viewBox="0 0 20 20"
              style={{
                display: 'block',
                // Slight nudge so the arrow tip — not the bounding box top-left —
                // sits exactly at the reported position.
                marginLeft: -2,
                marginTop: -2,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
              }}
            >
              <path
                d="M3 2 L17 9 L10 11 L8 17 Z"
                fill={peer.color}
                stroke="white"
                strokeWidth={1.25}
                strokeLinejoin="round"
              />
            </svg>

            {/* Name label */}
            <div
              className="absolute whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
              style={{
                left: 16,
                top: 16,
                background: peer.color,
                // Keep contrast against any background. White text + a tiny
                // dark outline reads cleanly on every palette entry above.
                textShadow: '0 1px 0 rgba(0,0,0,0.15)',
              }}
            >
              {peer.userName}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(CursorOverlayImpl);
