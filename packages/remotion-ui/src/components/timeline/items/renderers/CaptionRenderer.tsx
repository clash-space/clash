import React from 'react';
import type { CaptionItem } from '@master-clash/remotion-core';
import type { ItemRenderProps } from '../registry';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const CaptionRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const caption = item as CaptionItem;
  const cueCount = caption.cues?.length ?? 0;
  const wordRefCount = caption.wordRefs?.length ?? 0;
  const mapCount = caption.sourceToOutputMap?.length ?? 0;
  const firstCueText = caption.cues?.[0]?.text ?? 'No cues';

  return (
    <div
      data-timeline-item-type="caption"
      style={{
        width,
        height,
        borderRadius: 2,
        background: 'linear-gradient(135deg, #0f766e 0%, #155e75 100%)',
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
      title={`Caption track: ${plural(cueCount, 'cue')}, ${plural(wordRefCount, 'word ref')}, ${plural(mapCount, 'source map')}`}
    >
      <span>Caption</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {firstCueText}
      </span>
      {width >= 72 && <span style={{ opacity: 0.84 }}>{plural(cueCount, 'cue')}</span>}
    </div>
  );
};
