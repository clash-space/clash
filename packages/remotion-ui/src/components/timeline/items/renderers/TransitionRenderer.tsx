import React from 'react';
import type { TransitionItem } from '@master-clash/remotion-core';
import type { ItemRenderProps } from '../registry';

/**
 * Visualizes a TransitionItem in the timeline. Distinct from media clip
 * renderers — uses a striped purple background + arrow icon + the
 * transition type as a label so users can tell at a glance "this is a
 * transition, not a clip".
 */
export const TransitionRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const t = item as TransitionItem;

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        borderRadius: 2,
        // Diagonal stripes — cheap visual cue that this isn't normal media.
        backgroundImage:
          'repeating-linear-gradient(135deg, rgba(168, 85, 247, 0.85) 0 8px, rgba(139, 92, 246, 0.85) 8px 16px)',
        color: 'white',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textShadow: '0 1px 1px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
      }}
      title={`Transition: ${t.transitionType} (${t.fromItemId ?? '?'} → ${t.toItemId ?? '?'})`}
    >
      {height >= 24 && (
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
      {/* Hide label on very narrow items so it doesn't visually overflow. */}
      {width >= 60 && <span>{t.transitionType}</span>}
    </div>
  );
};
