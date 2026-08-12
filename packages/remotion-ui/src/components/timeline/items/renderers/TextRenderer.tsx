import React from 'react';
import type { TextItem } from '@clash/remotion-core';
import type { ItemRenderProps } from '../registry';
import { colors } from '../../styles';

export const TextRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const text = item as TextItem;
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: 'transparent',
        color: colors.itemText.text,
        display: 'flex',
        alignItems: 'center',
        padding: '4px 8px',
        fontSize: text.fontSize || 16,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
      title={text.text}
    >
      {text.text}
    </div>
  );
};
