import React from 'react';
import type { SolidItem } from '@clash/remotion-core';
import type { ItemRenderProps } from '../registry';

export const SolidRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const solid = item as SolidItem;
  return <div style={{ width, height, background: solid.color, borderRadius: 2 }} />;
};

