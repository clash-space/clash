import type {
  CaptionCue,
  CaptionWordReference,
  SourceToOutputFrameMap,
  SubtitleTextItem,
  TimelineTranscriptWord,
} from '@clash/remotion-core';

type CreateId = (prefix: string) => string;
type ParsedCue = { startSeconds: number; endSeconds: number; text: string };

const CJK_CHARACTER = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const NO_SPACE_BEFORE = /^(?:[,.;:!?%)}，。！？；：、）》】”’…]|\])/;
const CAPTION_BREAK_PUNCTUATION = /[,.;:!?，。！？；：、…]["'”’）》】]*$/u;

function joinCaptionWords(words: string[]): string {
  let result = '';
  for (const word of words) {
    const text = word.trim();
    if (!text) continue;
    const resultCharacters = Array.from(result);
    const previous = resultCharacters[resultCharacters.length - 1] ?? '';
    const current = Array.from(text)[0] ?? '';
    const needsSpace = Boolean(
      result
      && !NO_SPACE_BEFORE.test(text)
      && !CJK_CHARACTER.test(previous)
      && !CJK_CHARACTER.test(current),
    );
    result += `${needsSpace ? ' ' : ''}${text}`;
  }
  return result;
}

function cleanCaptionText(text: string): string {
  return text
    .replace(/\\N/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function parseClock(value: string): number {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid caption timestamp: ${value}`);
  }
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  throw new Error(`Invalid caption timestamp: ${value}`);
}

function parseTimedText(contents: string): ParsedCue[] {
  const blocks = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: ParsedCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex]!.match(/^(\S+)\s+-->\s+(\S+)/);
    if (!timing) continue;
    const text = cleanCaptionText(lines.slice(timingIndex + 1).join('\n'));
    if (!text) continue;
    cues.push({
      startSeconds: parseClock(timing[1]!),
      endSeconds: parseClock(timing[2]!),
      text,
    });
  }
  return cues;
}

function parseAss(contents: string): ParsedCue[] {
  const cues: ParsedCue[] = [];
  for (const line of contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!/^Dialogue\s*:/i.test(line)) continue;
    const fields = line.replace(/^Dialogue\s*:\s*/i, '').split(',');
    if (fields.length < 10) continue;
    const text = cleanCaptionText(fields.slice(9).join(','));
    if (!text) continue;
    cues.push({
      startSeconds: parseClock(fields[1]!),
      endSeconds: parseClock(fields[2]!),
      text,
    });
  }
  return cues;
}

function buildImportedCaptionItem(options: {
  parsedCues: ParsedCue[];
  fps: number;
  createId: CreateId;
}): SubtitleTextItem {
  const cues: CaptionCue[] = [];
  const wordRefs: CaptionWordReference[] = [];
  const sourceToOutputMap: SourceToOutputFrameMap[] = [];
  options.parsedCues.forEach((parsed, index) => {
    const startFrame = Math.max(0, Math.floor(parsed.startSeconds * options.fps));
    const endFrame = Math.max(startFrame + 1, Math.ceil(parsed.endSeconds * options.fps));
    const wordId = options.createId(`caption-import-word-${index + 1}`);
    cues.push({
      id: options.createId(`caption-import-cue-${index + 1}`),
      startFrame,
      durationInFrames: endFrame - startFrame,
      text: parsed.text,
      wordIds: [wordId],
      sourceStartFrame: startFrame,
      sourceEndFrame: endFrame,
    });
    wordRefs.push({ id: wordId, text: parsed.text, sourceStartFrame: startFrame, sourceEndFrame: endFrame });
    sourceToOutputMap.push({
      sourceStartFrame: startFrame,
      sourceEndFrame: endFrame,
      outputStartFrame: startFrame,
      outputEndFrame: endFrame,
    });
  });
  const durationInFrames = Math.max(...cues.map((cue) => cue.startFrame + cue.durationInFrames));
  return {
    id: options.createId('caption-import'),
    type: 'text',
    text: cues.map((cue) => cue.text).join('\n'),
    color: '#ffffff',
    from: 0,
    durationInFrames,
    cues,
    wordRefs,
    sourceToOutputMap,
    style: {
      fontSize: 48,
      fontWeight: 650,
      color: '#ffffff',
      backgroundColor: 'rgba(12,18,28,0.62)',
      position: 'bottom',
    },
  };
}

export function parseCaptionFile(options: {
  fileName: string;
  contents: string;
  fps: number;
  createId: CreateId;
}): SubtitleTextItem {
  const extension = options.fileName.split('.').pop()?.toLowerCase();
  if (!['ass', 'ssa', 'srt', 'vtt'].includes(extension ?? '')) {
    throw new Error('Unsupported subtitle file. Use SRT, VTT, ASS, or SSA.');
  }
  const parsedCues = extension === 'ass' || extension === 'ssa'
    ? parseAss(options.contents)
    : parseTimedText(options.contents);
  if (parsedCues.length === 0) throw new Error('No valid subtitle cues were found in this file.');
  return buildImportedCaptionItem({ parsedCues, fps: options.fps, createId: options.createId });
}

export function buildCaptionItemFromTimelineWords(options: {
  words: TimelineTranscriptWord[];
  durationInFrames: number;
  createId: CreateId;
}): SubtitleTextItem {
  if (options.words.length === 0) throw new Error('No recognized words are available for captions.');
  const groups: TimelineTranscriptWord[][] = [];
  for (const word of options.words) {
    let current = groups[groups.length - 1];
    const first = current?.[0];
    const previous = current?.[current.length - 1];
    const shouldStartGroup = !current
      || !first
      || !previous
      || first.clipId !== word.clipId
      || word.timelineStartFrame - previous.timelineEndFrame > 18;
    if (shouldStartGroup) {
      current = [word];
      groups.push(current);
    } else {
      current.push(word);
    }
    if (CAPTION_BREAK_PUNCTUATION.test(word.text.trim())) groups.push([]);
  }
  const populatedGroups = groups.filter((group) => group.length > 0);
  const cues: CaptionCue[] = [];
  const wordRefs: CaptionWordReference[] = [];
  const sourceToOutputMap: SourceToOutputFrameMap[] = [];

  for (const [groupIndex, group] of populatedGroups.entries()) {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const sourceStartFrame = Math.min(...group.map((word) => word.sourceStartFrame));
    const sourceEndFrame = Math.max(...group.map((word) => word.sourceEndFrame));
    const outputStartFrame = first.timelineStartFrame;
    const outputEndFrame = Math.max(outputStartFrame + 1, last.timelineEndFrame);
    const wordIds = group.map((word, wordIndex) => {
      const id = options.createId(`caption-word-${groupIndex + 1}-${wordIndex + 1}`);
      wordRefs.push({
        id,
        text: word.text,
        assetId: word.assetId,
        assetWordId: word.assetWordId,
        clipId: word.clipId,
        ...(word.trackId ? { trackId: word.trackId } : {}),
        sourceStartFrame: word.sourceStartFrame,
        sourceEndFrame: word.sourceEndFrame,
        ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
      });
      return id;
    });
    sourceToOutputMap.push({
      sourceStartFrame,
      sourceEndFrame,
      outputStartFrame,
      outputEndFrame,
    });
    cues.push({
      id: options.createId(`caption-cue-${groupIndex + 1}`),
      startFrame: outputStartFrame,
      durationInFrames: outputEndFrame - outputStartFrame,
      text: joinCaptionWords(group.map((word) => word.text)),
      wordIds,
      sourceStartFrame,
      sourceEndFrame,
    });
  }

  return {
    id: options.createId('caption-recognition'),
    type: 'text',
    text: cues.map((cue) => cue.text).join('\n'),
    color: '#ffffff',
    from: 0,
    durationInFrames: Math.max(options.durationInFrames, ...cues.map((cue) => cue.startFrame + cue.durationInFrames)),
    cues,
    wordRefs,
    sourceToOutputMap,
    style: {
      fontSize: 48,
      fontWeight: 650,
      color: '#ffffff',
      backgroundColor: 'rgba(12,18,28,0.62)',
      position: 'bottom',
    },
  };
}
