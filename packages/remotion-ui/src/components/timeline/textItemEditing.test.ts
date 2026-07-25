import { describe, expect, it } from 'vitest';
import type { SubtitleTextItem, TextItem } from '@master-clash/remotion-core';
import { createTimelineTextEditUpdates } from './textItemEditing';

describe('timeline text sticker editing', () => {
  it('edits a plain text sticker directly', () => {
    const item: TextItem = {
      id: 'title',
      type: 'text',
      text: 'Before',
      color: '#fff',
      from: 0,
      durationInFrames: 30,
    };
    expect(createTimelineTextEditUpdates(item, 'After')).toEqual({ text: 'After' });
  });

  it('keeps the single subtitle cue in sync with inline sticker edits', () => {
    const item: SubtitleTextItem = {
      id: 'subtitle',
      type: 'text',
      text: 'Before',
      color: '#fff',
      from: 10,
      durationInFrames: 30,
      cues: [{
        id: 'cue',
        startFrame: 0,
        durationInFrames: 30,
        text: 'Before',
        wordIds: ['word'],
      }],
      wordRefs: [{ id: 'word', text: 'Before', sourceStartFrame: 0, sourceEndFrame: 30 }],
      sourceToOutputMap: [],
    };

    expect(createTimelineTextEditUpdates(item, 'After')).toEqual({
      text: 'After',
      cues: [{ ...item.cues[0], text: 'After' }],
    });
  });
});
