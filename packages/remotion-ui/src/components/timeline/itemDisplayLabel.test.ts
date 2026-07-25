import { describe, expect, it } from 'vitest';
import { getTimelineItemDisplayLabel } from './itemDisplayLabel';

describe('getTimelineItemDisplayLabel', () => {
  it('uses the business asset name instead of deriving a label from its source address', () => {
    expect(getTimelineItemDisplayLabel({
      type: 'image',
      assetName: 'Opening frame',
    })).toBe('Opening frame');
  });

  it.each([
    'projects/9102ae67-49df/private.png',
    'https://assets.example/private/video.mp4?token=secret',
    'fce43e93-badc-4c4e-9160-42526956f13c',
  ])('never exposes an internal asset address as the item label: %s', (assetName) => {
    expect(getTimelineItemDisplayLabel({
      type: 'image',
      assetName,
    })).toBe('Image');
  });

  it('keeps authored text and the color label', () => {
    expect(getTimelineItemDisplayLabel({ type: 'text', text: 'Title' })).toBe('Title');
    expect(getTimelineItemDisplayLabel({ type: 'solid' })).toBe('Color');
  });
});
