import type { CSSProperties } from 'react';

export const editorTypeScale = {
  caption: { size: '0.6875rem', lineHeight: '1rem' },
  control: { size: '0.75rem', lineHeight: '1.125rem' },
  item: { size: '0.8125rem', lineHeight: '1.25rem' },
  heading: { size: '0.875rem', lineHeight: '1.25rem' },
  metric: { size: '1.25rem', lineHeight: '1.5rem' },
} as const;

export const editorTypographyVariables = {
  '--clash-editor-text-caption': editorTypeScale.caption.size,
  '--clash-editor-leading-caption': editorTypeScale.caption.lineHeight,
  '--clash-editor-text-control': editorTypeScale.control.size,
  '--clash-editor-leading-control': editorTypeScale.control.lineHeight,
  '--clash-editor-text-item': editorTypeScale.item.size,
  '--clash-editor-leading-item': editorTypeScale.item.lineHeight,
  '--clash-editor-text-heading': editorTypeScale.heading.size,
  '--clash-editor-leading-heading': editorTypeScale.heading.lineHeight,
  '--clash-editor-text-metric': editorTypeScale.metric.size,
  '--clash-editor-leading-metric': editorTypeScale.metric.lineHeight,
} as CSSProperties;
