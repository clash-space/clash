import React from 'react';
import type { SubtitleTextItem } from '@master-clash/remotion-core';
import type { ItemRenderProps } from '../registry';
import { colors, timeline } from '../../styles';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const CaptionRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const caption = item as SubtitleTextItem;
  const cueCount = caption.cues?.length ?? 0;
  const wordRefCount = caption.wordRefs?.length ?? 0;
  const mapCount = caption.sourceToOutputMap?.length ?? 0;
  const sentenceText = caption.cues?.[0]?.text ?? caption.text;

  return (
    <div
      data-timeline-item-type="text"
      data-text-kind="subtitle"
      style={{
        width,
        height,
        borderRadius: timeline.itemBorderRadius,
        backgroundColor: colors.item.text,
        color: colors.itemText.text,
        display: 'flex',
        alignItems: 'center',
        padding: '4px 10px',
        overflow: 'hidden',
        fontSize: 12,
        fontWeight: 650,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
      title={`Subtitle text: ${plural(cueCount, 'cue')}, ${plural(wordRefCount, 'word ref')}, ${plural(mapCount, 'source map')}`}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sentenceText}
      </span>
    </div>
  );
};
