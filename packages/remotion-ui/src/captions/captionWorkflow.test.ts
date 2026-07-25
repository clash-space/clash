import { describe, expect, it } from 'vitest';
import { validateTimelineDsl, type SubtitleTextItem, type TimelineTranscriptWord } from '@master-clash/remotion-core';
import {
  buildCaptionItemFromTimelineWords,
  parseCaptionFile,
} from './captionWorkflow';

describe('caption workflow', () => {
  const expectValidCaption = (item: SubtitleTextItem) => {
    const result = validateTimelineDsl({
      tracks: [{ id: 'captions', name: 'Captions', role: 'subtitle', category: 'text', items: [item] }],
      compositionWidth: 1920,
      compositionHeight: 1080,
      fps: 30,
      durationInFrames: item.durationInFrames,
    });
    expect(result.issues).toEqual([]);
  };

  it('imports SRT as a lineage-complete structured caption item', () => {
    const item = parseCaptionFile({
      fileName: 'dialogue.srt',
      contents: [
        '1',
        '00:00:00,000 --> 00:00:01,250',
        'First line',
        '',
        '2',
        '00:00:01,500 --> 00:00:02,500',
        'Second line',
      ].join('\n'),
      fps: 30,
      createId: (prefix) => prefix,
    });

    expect(item).toMatchObject({
      type: 'text',
      text: 'First line\nSecond line',
      from: 0,
      durationInFrames: 75,
      cues: [
        { startFrame: 0, durationInFrames: 38, text: 'First line' },
        { startFrame: 45, durationInFrames: 30, text: 'Second line' },
      ],
    });
    expect(item.wordRefs).toHaveLength(2);
    expect(item.sourceToOutputMap).toHaveLength(2);
    expect(item.cues.every((cue) => cue.wordIds?.length === 1)).toBe(true);
    expectValidCaption(item);
  });

  it('imports WebVTT and ASS timing formats', () => {
    const vtt = parseCaptionFile({
      fileName: 'dialogue.vtt',
      contents: 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello VTT',
      fps: 30,
      createId: (prefix) => `vtt-${prefix}`,
    });
    const ass = parseCaptionFile({
      fileName: 'dialogue.ass',
      contents: '[Events]\nDialogue: 0,0:00:00.00,0:00:01.20,Default,,0,0,0,,Hello ASS',
      fps: 30,
      createId: (prefix) => `ass-${prefix}`,
    });

    expect(vtt.cues[0]).toMatchObject({ text: 'Hello VTT', durationInFrames: 30 });
    expect(ass.cues[0]).toMatchObject({ text: 'Hello ASS', durationInFrames: 36 });
  });

  it('groups recognized timeline words into readable caption cues', () => {
    const words: TimelineTranscriptWord[] = [
      { id: 'a', text: 'Hello', assetId: 'speech', assetWordId: 'a', clipId: 'clip', trackId: 'primary', sourceStartFrame: 0, sourceEndFrame: 10, timelineStartFrame: 0, timelineEndFrame: 10 },
      { id: 'b', text: 'world.', assetId: 'speech', assetWordId: 'b', clipId: 'clip', trackId: 'primary', sourceStartFrame: 10, sourceEndFrame: 20, timelineStartFrame: 10, timelineEndFrame: 20 },
    ];

    const item = buildCaptionItemFromTimelineWords({
      words,
      durationInFrames: 60,
      createId: (prefix) => prefix,
    });

    expect(item.cues).toEqual([
      expect.objectContaining({ text: 'Hello world.', startFrame: 0, durationInFrames: 20 }),
    ]);
    expect(item.wordRefs).toHaveLength(2);
    expect(item.wordRefs).toEqual([
      expect.objectContaining({ assetId: 'speech', assetWordId: 'a', clipId: 'clip', trackId: 'primary' }),
      expect.objectContaining({ assetId: 'speech', assetWordId: 'b', clipId: 'clip', trackId: 'primary' }),
    ]);
    expect(item.sourceToOutputMap).toEqual([
      {
        sourceStartFrame: 0,
        sourceEndFrame: 20,
        outputStartFrame: 0,
        outputEndFrame: 20,
      },
    ]);
    expectValidCaption(item);
  });

  it('keeps CJK character tokens together until sentence punctuation', () => {
    const characters = Array.from('如果视频不再是一个黑盒呢？');
    const words: TimelineTranscriptWord[] = characters.map((text, index) => ({
      id: `word-${index}`,
      text,
      assetId: 'speech',
      assetWordId: `source-${index}`,
      clipId: 'clip',
      trackId: 'voice',
      sourceStartFrame: index * 2,
      sourceEndFrame: index * 2 + 2,
      timelineStartFrame: index * 2,
      timelineEndFrame: index * 2 + 2,
    }));

    const item = buildCaptionItemFromTimelineWords({
      words,
      durationInFrames: 60,
      createId: (prefix) => prefix,
    });

    expect(item.cues).toHaveLength(1);
    expect(item.cues[0]).toMatchObject({
      text: '如果视频不再是一个黑盒呢？',
      startFrame: 0,
      durationInFrames: characters.length * 2,
    });
  });
});
