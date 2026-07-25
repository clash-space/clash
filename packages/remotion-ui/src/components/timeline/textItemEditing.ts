import {
  isSubtitleTextItem,
  type Item,
  type TextItem,
} from '@master-clash/remotion-core';

export function createTimelineTextEditUpdates(
  item: TextItem,
  nextText: string,
): Partial<Item> {
  if (!isSubtitleTextItem(item)) return { text: nextText };
  if (item.cues.length !== 1) return { text: nextText };
  return {
    text: nextText,
    cues: [{ ...item.cues[0]!, text: nextText }],
  };
}
