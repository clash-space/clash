import type {
  EditorAssetTranscript,
  SourceToOutputFrameMap,
  SubtitleTextItem,
  TimelineTranscriptWord,
  Track,
} from "./types";
import { isSubtitleTextItem } from "./types";

export type TimelineTranscriptSentence = {
  id: string;
  text: string;
  timelineStartFrame: number;
  timelineEndFrame: number;
  wordIds: string[];
};

const SENTENCE_END_PATTERN = /[.!?。！？…]+["'”’）》】]*$/u;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const NO_LEADING_SPACE_PATTERN = /^[,.;:!?，。！？；：、…%)）】》”’]/u;
const NO_TRAILING_SPACE_PATTERN = /[(（【《“‘]$/u;

function frameMapsAreEqual(
  left: SourceToOutputFrameMap,
  right: SourceToOutputFrameMap,
): boolean {
  return left.sourceStartFrame === right.sourceStartFrame
    && left.sourceEndFrame === right.sourceEndFrame
    && left.outputStartFrame === right.outputStartFrame
    && left.outputEndFrame === right.outputEndFrame;
}

function deduplicateFrameMaps(
  maps: SourceToOutputFrameMap[],
): SourceToOutputFrameMap[] {
  return maps.filter(
    (candidate, index) => maps.findIndex((entry) => frameMapsAreEqual(entry, candidate)) === index,
  );
}

function joinTranscriptTokens(tokens: string[]): string {
  return tokens.reduce((text, token) => {
    const next = token.trim();
    if (!next) return text;
    if (!text) return next;
    const previousCharacter = text.slice(-1);
    const nextCharacter = next.charAt(0);
    const joinsWithoutSpace = NO_LEADING_SPACE_PATTERN.test(next)
      || NO_TRAILING_SPACE_PATTERN.test(text)
      || CJK_PATTERN.test(previousCharacter)
      || CJK_PATTERN.test(nextCharacter);
    return `${text}${joinsWithoutSpace ? "" : " "}${next}`;
  }, "");
}

/**
 * Legacy caption documents stored every cue inside one full-duration Text
 * item. Text is a visual sticker, so canonical documents keep one sentence
 * cue per independently movable and editable Text item.
 */
export function splitSubtitleTextItemIntoStickers(
  item: SubtitleTextItem,
): SubtitleTextItem[] {
  if (item.cues.length === 0) return [item];
  if (item.cues.length === 1 && item.cues[0]?.startFrame === 0) return [item];

  return item.cues.map((cue, cueIndex) => {
    const cueWordIds = new Set(cue.wordIds ?? []);
    const wordRefs = (item.wordRefs ?? []).filter((word) => cueWordIds.has(word.id));
    const fallbackSourceStart = wordRefs.length > 0
      ? Math.min(...wordRefs.map((word) => word.sourceStartFrame))
      : cue.startFrame;
    const fallbackSourceEnd = wordRefs.length > 0
      ? Math.max(...wordRefs.map((word) => word.sourceEndFrame))
      : cue.startFrame + cue.durationInFrames;
    const sourceStartFrame = cue.sourceStartFrame ?? fallbackSourceStart;
    const sourceEndFrame = cue.sourceEndFrame ?? fallbackSourceEnd;
    const cueOutputStart = cue.startFrame;
    const cueOutputEnd = cue.startFrame + cue.durationInFrames;
    const shiftedMaps = deduplicateFrameMaps(
      (item.sourceToOutputMap ?? [])
        .filter((entry) =>
          entry.outputEndFrame > cueOutputStart
          && entry.outputStartFrame < cueOutputEnd
          && entry.sourceEndFrame > sourceStartFrame
          && entry.sourceStartFrame < sourceEndFrame
        )
        .map((entry) => ({
          ...entry,
          outputStartFrame: Math.max(0, entry.outputStartFrame - cueOutputStart),
          outputEndFrame: Math.min(
            cue.durationInFrames,
            Math.max(1, entry.outputEndFrame - cueOutputStart),
          ),
        }))
        .filter((entry) => entry.outputEndFrame > entry.outputStartFrame),
    );
    const canonicalMap: SourceToOutputFrameMap = {
      sourceStartFrame,
      sourceEndFrame,
      outputStartFrame: 0,
      outputEndFrame: cue.durationInFrames,
    };
    const sourceToOutputMap = shiftedMaps.some(
      (entry) => frameMapsAreEqual(entry, canonicalMap),
    )
      ? shiftedMaps
      : [...shiftedMaps, canonicalMap];
    const { fromExpr: _fromExpr, ...withoutFromExpression } = item;

    return {
      ...withoutFromExpression,
      id: cueIndex === 0 ? item.id : `${item.id}:cue:${cue.id}`,
      text: cue.text,
      from: item.from + cue.startFrame,
      durationInFrames: cue.durationInFrames,
      cues: [{
        ...cue,
        startFrame: 0,
        durationInFrames: cue.durationInFrames,
      }],
      wordRefs,
      sourceToOutputMap,
    };
  });
}

function subtitleItemTimelineOffset(item: SubtitleTextItem): number {
  const cuesAreItemRelative = item.cues.every(
    (cue) => cue.startFrame + cue.durationInFrames <= item.durationInFrames,
  );
  const mapsAreItemRelative = (item.sourceToOutputMap ?? []).every(
    (entry) => entry.outputEndFrame <= item.durationInFrames,
  );
  return cuesAreItemRelative && mapsAreItemRelative ? item.from : 0;
}

/**
 * Builds readable sentence blocks while preserving the word stream as the
 * source of truth for frame-accurate agent edits.
 */
export function deriveTimelineTranscriptSentences(input: {
  words: TimelineTranscriptWord[];
  fps: number;
  pauseBoundarySeconds?: number;
}): TimelineTranscriptSentence[] {
  const words = [...input.words].sort(
    (left, right) =>
      left.timelineStartFrame - right.timelineStartFrame
      || left.timelineEndFrame - right.timelineEndFrame
      || left.id.localeCompare(right.id),
  );
  if (words.length === 0) return [];

  const pauseBoundaryFrames = Math.max(
    1,
    Math.round((input.pauseBoundarySeconds ?? 0.45) * Math.max(1, input.fps)),
  );
  const sentences: TimelineTranscriptSentence[] = [];
  let sentenceWords: TimelineTranscriptWord[] = [];

  const flushSentence = () => {
    if (sentenceWords.length === 0) return;
    const first = sentenceWords[0];
    const last = sentenceWords[sentenceWords.length - 1];
    sentences.push({
      id: `${first.id}:sentence`,
      text: joinTranscriptTokens(sentenceWords.map((word) => word.text)),
      timelineStartFrame: first.timelineStartFrame,
      timelineEndFrame: last.timelineEndFrame,
      wordIds: sentenceWords.map((word) => word.id),
    });
    sentenceWords = [];
  };

  words.forEach((word, index) => {
    sentenceWords.push(word);
    const next = words[index + 1];
    if (!next) {
      flushSentence();
      return;
    }
    const gap = next.timelineStartFrame - word.timelineEndFrame;
    const clipChanged = next.clipId !== word.clipId;
    const speakerChanged = Boolean(
      word.speakerId
      && next.speakerId
      && word.speakerId !== next.speakerId,
    );
    const sentenceEnded = SENTENCE_END_PATTERN.test(word.text.trim());
    const sentenceIsLong = sentenceWords.length >= 24
      || next.timelineEndFrame - sentenceWords[0].timelineStartFrame >= input.fps * 8;
    if (
      sentenceEnded
      || clipChanged
      || speakerChanged
      || gap >= pauseBoundaryFrames
      || sentenceIsLong
    ) {
      flushSentence();
    }
  });

  return sentences;
}

/**
 * Caption Text cues are user-editable sentence boundaries, so they take
 * precedence over heuristic ASR grouping whenever lineage is available.
 */
export function deriveTimelineTranscriptSentencesFromText(input: {
  tracks: Track[];
  trackId: string;
  fps?: number;
}): TimelineTranscriptSentence[] {
  const cueBlocks: Array<TimelineTranscriptSentence & { itemId: string }> = [];

  for (const item of input.tracks.flatMap((track) => track.items)) {
    if (!isSubtitleTextItem(item)) continue;
    const timelineOffset = subtitleItemTimelineOffset(item);
    const wordRefsById = new Map(
      (item.wordRefs ?? []).map((word) => [word.id, word]),
    );
    for (const cue of item.cues) {
      const cueWordIds = cue.wordIds ?? [];
      const belongsToTrack = cueWordIds.some(
        (wordId) => wordRefsById.get(wordId)?.trackId === input.trackId,
      );
      if (!belongsToTrack) continue;
      cueBlocks.push({
        id: `${item.id}:${cue.id}`,
        itemId: item.id,
        text: cue.text,
        timelineStartFrame: timelineOffset + cue.startFrame,
        timelineEndFrame: timelineOffset + cue.startFrame + cue.durationInFrames,
        wordIds: cueWordIds,
      });
    }
  }

  cueBlocks.sort(
    (left, right) =>
      left.timelineStartFrame - right.timelineStartFrame
      || left.timelineEndFrame - right.timelineEndFrame
      || left.id.localeCompare(right.id),
  );

  const pauseBoundaryFrames = Math.max(1, Math.round((input.fps ?? 30) * 0.45));
  const sentences: TimelineTranscriptSentence[] = [];
  let sentenceCues: typeof cueBlocks = [];

  const flushSentence = () => {
    if (sentenceCues.length === 0) return;
    const first = sentenceCues[0];
    const last = sentenceCues[sentenceCues.length - 1];
    sentences.push({
      id: sentenceCues.length === 1 ? first.id : `${first.id}:sentence`,
      text: joinTranscriptTokens(sentenceCues.map((cue) => cue.text)),
      timelineStartFrame: first.timelineStartFrame,
      timelineEndFrame: last.timelineEndFrame,
      wordIds: sentenceCues.flatMap((cue) => cue.wordIds),
    });
    sentenceCues = [];
  };

  cueBlocks.forEach((cue, index) => {
    sentenceCues.push(cue);
    const next = cueBlocks[index + 1];
    if (!next) {
      flushSentence();
      return;
    }
    const gap = next.timelineStartFrame - cue.timelineEndFrame;
    if (
      SENTENCE_END_PATTERN.test(cue.text.trim())
      || next.itemId !== cue.itemId
      || gap >= pauseBoundaryFrames
    ) {
      flushSentence();
    }
  });

  return sentences;
}

export function isSpokenMediaTrack(
  track: Track,
  primaryTrackId?: string | null,
): boolean {
  if (!track.items.some((item) => item.type === "video" || item.type === "audio")) {
    return false;
  }
  const role = track.role as string | undefined;
  if (
    role === "music"
    || role === "sfx"
    || role === "subtitle"
    || role === "transition"
    || role === "b-roll"
    || role === "overlay"
  ) {
    return false;
  }
  if (
    primaryTrackId
    && track.id === primaryTrackId
    && track.items.some((item) => item.type === "video")
  ) {
    return true;
  }
  if (role === "narration" || role === "primary-video" || role === "dialogue") {
    return true;
  }
  return role === undefined || role === "mixed";
}

export function selectSpokenMediaTracks(
  tracks: Track[],
  primaryTrackId?: string | null,
): Track[] {
  const primaryTrack = primaryTrackId
    ? tracks.find((track) => track.id === primaryTrackId)
    : undefined;
  if (primaryTrack && isSpokenMediaTrack(primaryTrack, primaryTrackId)) {
    return [primaryTrack];
  }
  return tracks.filter((track) => isSpokenMediaTrack(track, primaryTrackId));
}

export function deriveTimelineTranscriptWords(input: {
  tracks: Track[];
  fps: number;
  assetTranscripts: Record<string, EditorAssetTranscript>;
}): TimelineTranscriptWord[] {
  const words: TimelineTranscriptWord[] = [];

  for (const track of input.tracks) {
    for (const item of track.items) {
      if ((item.type !== "video" && item.type !== "audio") || !item.assetId)
        continue;
      const transcript = input.assetTranscripts[item.assetId];
      if (!transcript) continue;
      const clipSourceStart = item.sourceStartInFrames ?? 0;
      const clipSourceEnd = clipSourceStart + item.durationInFrames;

      for (const sourceWord of transcript.words) {
        const wordStart = Math.floor((sourceWord.startMs / 1000) * input.fps);
        const wordEnd = Math.max(
          wordStart + 1,
          Math.ceil((sourceWord.endMs / 1000) * input.fps),
        );
        const sourceStartFrame = Math.max(wordStart, clipSourceStart);
        const sourceEndFrame = Math.min(wordEnd, clipSourceEnd);
        if (sourceEndFrame <= sourceStartFrame) continue;
        const timelineStartFrame =
          item.from + sourceStartFrame - clipSourceStart;
        const timelineEndFrame = item.from + sourceEndFrame - clipSourceStart;
        words.push({
          id: `${item.id}:${sourceWord.id}`,
          text: sourceWord.text,
          assetId: item.assetId,
          assetWordId: sourceWord.id,
          clipId: item.id,
          trackId: track.id,
          sourceStartFrame,
          sourceEndFrame,
          timelineStartFrame,
          timelineEndFrame,
          ...(sourceWord.confidence === undefined
            ? {}
            : { confidence: sourceWord.confidence }),
          ...(sourceWord.speakerId === undefined
            ? {}
            : { speakerId: sourceWord.speakerId }),
        });
      }
    }
  }

  return words.sort(
    (left, right) =>
      left.timelineStartFrame - right.timelineStartFrame ||
      left.timelineEndFrame - right.timelineEndFrame ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Rebuilds the word stream from the persisted Text item when the reusable ASR
 * cache has not been loaded yet. Word lineage plus source-to-output mappings
 * make this seek-safe after ripple edits and across editor reloads.
 */
export function deriveTimelineTranscriptWordsFromText(input: {
  tracks: Track[];
  trackId: string;
}): TimelineTranscriptWord[] {
  const words: TimelineTranscriptWord[] = [];

  for (const item of input.tracks.flatMap((track) => track.items)) {
    if (!isSubtitleTextItem(item) || !item.wordRefs?.length) continue;
    const timelineOffset = subtitleItemTimelineOffset(item);
    for (const word of item.wordRefs) {
      if (word.trackId !== input.trackId) continue;
      const sourceToOutput = item.sourceToOutputMap?.find((entry) =>
        word.sourceStartFrame >= entry.sourceStartFrame
        && word.sourceEndFrame <= entry.sourceEndFrame
      ) ?? item.cues
        .filter((cue) => cue.wordIds?.includes(word.id))
        .map((cue) => (
          cue.sourceStartFrame === undefined || cue.sourceEndFrame === undefined
            ? null
            : {
              sourceStartFrame: cue.sourceStartFrame,
              sourceEndFrame: cue.sourceEndFrame,
              outputStartFrame: cue.startFrame,
              outputEndFrame: cue.startFrame + cue.durationInFrames,
            }
        ))
        .find((entry): entry is NonNullable<typeof entry> => entry !== null);

      const mapFrame = (sourceFrame: number): number => {
        if (!sourceToOutput) return sourceFrame;
        const sourceDuration = Math.max(
          1,
          sourceToOutput.sourceEndFrame - sourceToOutput.sourceStartFrame,
        );
        const outputDuration = Math.max(
          1,
          sourceToOutput.outputEndFrame - sourceToOutput.outputStartFrame,
        );
        return sourceToOutput.outputStartFrame + Math.round(
          ((sourceFrame - sourceToOutput.sourceStartFrame) / sourceDuration) * outputDuration,
        );
      };
      const timelineStartFrame = Math.max(
        0,
        timelineOffset + mapFrame(word.sourceStartFrame),
      );
      const timelineEndFrame = Math.max(
        timelineStartFrame + 1,
        timelineOffset + mapFrame(word.sourceEndFrame),
      );
      words.push({
        id: `${word.clipId ?? "caption"}:${word.assetWordId ?? word.id}`,
        text: word.text,
        assetId: word.assetId ?? "caption-lineage",
        assetWordId: word.assetWordId ?? word.id,
        clipId: word.clipId ?? item.id,
        trackId: word.trackId,
        sourceStartFrame: word.sourceStartFrame,
        sourceEndFrame: word.sourceEndFrame,
        timelineStartFrame,
        timelineEndFrame,
        ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
      });
    }
  }

  return words.sort(
    (left, right) =>
      left.timelineStartFrame - right.timelineStartFrame
      || left.timelineEndFrame - right.timelineEndFrame
      || left.id.localeCompare(right.id),
  );
}
