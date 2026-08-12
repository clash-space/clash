import React from 'react';
import type { DerivedOverlayItem } from '@clash/remotion-core';
import type { ItemRenderProps } from '../registry';

export const DerivedOverlayRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const overlay = item as DerivedOverlayItem;
  const lineage = `${overlay.sourceAssetId} -> ${overlay.derivedAssetId}`;

  return (
    <div
      data-timeline-item-type="derived-overlay"
      style={{
        width,
        height,
        borderRadius: 2,
        background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
        color: '#ffffff',
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        overflow: 'hidden',
        fontSize: 11,
        fontWeight: 650,
        lineHeight: 1.1,
        textShadow: '0 1px 1px rgba(0,0,0,0.35)',
      }}
      title={`Derived overlay (${overlay.mediaType}, copy-on-write): ${lineage}. ${overlay.derivation?.description ?? overlay.src}`}
    >
      <span>Derived overlay</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lineage}
      </span>
      {width >= 72 && <span style={{ opacity: 0.86 }}>{overlay.derivation?.kind ?? 'derived'}</span>}
    </div>
  );
};
