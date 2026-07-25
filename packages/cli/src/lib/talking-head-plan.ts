import {
  AssetMetadataFillActionSchema,
  TranscriptWordSchema,
  type AsrTranscriptMetadata,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

type TranscriptWord = {
  id: string;
  text: string;
  startFrame: number;
  endFrame: number;
};

type DisfluencyType = "filler" | "silence" | "tone-particle" | "repeat";

type DisfluencyRange = {
  id: string;
  type: DisfluencyType;
  startFrame: number;
  endFrame: number;
  wordId?: string;
  text?: string;
  requiresReview: boolean;
  confidence: number;
  detectionSource: "configured-token" | "word-gap" | "adjacent-token-repeat";
};

export type PlanTalkingHeadTextCutActionOptions = {
  targetAssetId: string;
  words: TranscriptWord[];
  fps: number;
  minSilenceFrames?: number;
  actionId?: string;
  producer?: string;
  createdAt?: string;
  fillerWords?: string[];
  toneParticles?: string[];
  asr?: AsrTranscriptMetadata;
};

const DEFAULT_FILLER_WORDS = ["嗯", "呃", "额", "呃呃", "嗯嗯", "uh", "um", "erm", "em"];
const DEFAULT_TONE_PARTICLES = ["啊", "呀", "吧", "呢", "嘛", "哈"];

export function planTalkingHeadTextCutAction(
  options: PlanTalkingHeadTextCutActionOptions,
): AssetMetadataFillAction {
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("fps must be a positive number");
  }
  const words = validateWords(options.words);
  const minSilenceFrames = options.minSilenceFrames ?? Math.round(options.fps * 0.5);
  if (!Number.isInteger(minSilenceFrames) || minSilenceFrames < 0) {
    throw new Error("minSilenceFrames must be a non-negative integer");
  }

  const fillerWords = new Set((options.fillerWords ?? DEFAULT_FILLER_WORDS).map(normalizeToken));
  const toneParticles = new Set((options.toneParticles ?? DEFAULT_TONE_PARTICLES).map(normalizeToken));
  const disfluencies = detectDisfluencies(words, { fillerWords, toneParticles, minSilenceFrames });
  const cuts = buildCuts(words, disfluencies);
  const captionCues = buildCaptionCues(words, cuts, disfluencies);

  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `talking-head-text-cut-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "talking-head.analysis",
    producer: options.producer ?? "clash-production-plan-text-cut",
    createdAt: options.createdAt,
    metadata: {
      kind: "talking-head.analysis",
      fps: options.fps,
      ...(options.asr ? { asr: options.asr } : {}),
      words,
      cuts,
      captionCues,
      disfluencies,
    },
  });
}

function validateWords(input: TranscriptWord[]): TranscriptWord[] {
  const words = TranscriptWordSchema.array().parse(input)
    .slice()
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  for (const word of words) {
    if (word.endFrame <= word.startFrame) {
      throw new Error(`word ${word.id} must have endFrame greater than startFrame`);
    }
  }
  return words;
}

function detectDisfluencies(
  words: TranscriptWord[],
  options: {
    fillerWords: Set<string>;
    toneParticles: Set<string>;
    minSilenceFrames: number;
  },
): DisfluencyRange[] {
  const out: DisfluencyRange[] = [];
  let previousWord: TranscriptWord | null = null;
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex];
    if (previousWord) {
      const gap = word.startFrame - previousWord.endFrame;
      if (gap >= options.minSilenceFrames) {
        out.push({
          id: `silence-${previousWord.id}-${word.id}`,
          type: "silence",
          startFrame: previousWord.endFrame,
          endFrame: word.startFrame,
          requiresReview: false,
          confidence: 0.98,
          detectionSource: "word-gap",
        });
      }
    }

    const normalized = normalizeToken(word.text);
    if (
      previousWord &&
      normalized.length > 0 &&
      normalized === normalizeToken(previousWord.text) &&
      !isConfiguredDisfluency(normalized, options)
    ) {
      out.push({
        id: `repeat-${previousWord.id}-${word.id}`,
        type: "repeat",
        wordId: previousWord.id,
        text: previousWord.text,
        startFrame: previousWord.startFrame,
        endFrame: previousWord.endFrame,
        requiresReview: true,
        confidence: 0.68,
        detectionSource: "adjacent-token-repeat",
      });
    }
    const type = options.fillerWords.has(normalized)
      ? "filler"
      : options.toneParticles.has(normalized)
        ? "tone-particle"
        : null;
    if (type) {
      const trailingToken = words[wordIndex + 1];
      const endFrame = trailingToken && isPunctuationToken(trailingToken.text)
        ? trailingToken.endFrame
        : word.endFrame;
      out.push({
        id: `${type}-${word.id}`,
        type,
        wordId: word.id,
        text: word.text,
        startFrame: word.startFrame,
        endFrame,
        requiresReview: type === "tone-particle",
        confidence: type === "filler" ? 0.92 : 0.72,
        detectionSource: "configured-token",
      });
    }
    previousWord = word;
  }
  return out.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

function isConfiguredDisfluency(
  normalizedToken: string,
  options: {
    fillerWords: Set<string>;
    toneParticles: Set<string>;
  },
): boolean {
  return options.fillerWords.has(normalizedToken) || options.toneParticles.has(normalizedToken);
}

function buildCuts(words: TranscriptWord[], disfluencies: DisfluencyRange[]) {
  if (words.length === 0) return [];
  const cuts: Array<{
    id: string;
    sourceStartFrame: number;
    sourceEndFrame: number;
    outputStartFrame: number;
    outputEndFrame: number;
    action: "keep" | "delete" | "review";
    reason?: string;
    requiresReview?: boolean;
    confidence?: number;
    detectionSource?: string;
  }> = [];
  let sourceCursor = words[0].startFrame;
  let outputCursor = 0;
  let keepIndex = 1;
  let deleteIndex = 1;

  for (const range of disfluencies) {
    if (range.endFrame <= sourceCursor) continue;
    if (range.startFrame > sourceCursor) {
      const duration = range.startFrame - sourceCursor;
      cuts.push({
        id: `keep-${keepIndex++}`,
        sourceStartFrame: sourceCursor,
        sourceEndFrame: range.startFrame,
        outputStartFrame: outputCursor,
        outputEndFrame: outputCursor + duration,
        action: "keep",
      });
      outputCursor += duration;
    }
    const deleteStart = Math.max(sourceCursor, range.startFrame);
    const deleteEnd = Math.max(deleteStart, range.endFrame);
    cuts.push({
      id: `delete-${deleteIndex++}`,
      sourceStartFrame: deleteStart,
      sourceEndFrame: deleteEnd,
      outputStartFrame: outputCursor,
      outputEndFrame: outputCursor,
      action: range.requiresReview ? "review" : "delete",
      reason: range.type,
      requiresReview: range.requiresReview,
      confidence: range.confidence,
      detectionSource: range.detectionSource,
    });
    sourceCursor = deleteEnd;
  }

  const finalFrame = words[words.length - 1].endFrame;
  if (sourceCursor < finalFrame) {
    const duration = finalFrame - sourceCursor;
    cuts.push({
      id: `keep-${keepIndex++}`,
      sourceStartFrame: sourceCursor,
      sourceEndFrame: finalFrame,
      outputStartFrame: outputCursor,
      outputEndFrame: outputCursor + duration,
      action: "keep",
    });
  }
  return cuts;
}

function buildCaptionCues(
  words: TranscriptWord[],
  cuts: ReturnType<typeof buildCuts>,
  disfluencies: DisfluencyRange[],
) {
  const deletedWordIds = new Set(disfluencies.map((item) => item.wordId).filter((id): id is string => Boolean(id)));
  const captionOmittedWordIds = new Set([
    ...deletedWordIds,
    ...captionPunctuationCleanupWordIds(words, deletedWordIds),
  ]);
  return cuts
    .filter((cut) => cut.action === "keep")
    .map((cut, index) => {
      const cueWords = words.filter(
        (word) =>
          !captionOmittedWordIds.has(word.id) &&
          word.startFrame >= cut.sourceStartFrame &&
          word.endFrame <= cut.sourceEndFrame,
      );
      if (cueWords.length === 0) return null;
      return {
        id: `cue-${index + 1}`,
        startFrame: cut.outputStartFrame,
        durationInFrames: cut.outputEndFrame - cut.outputStartFrame,
        text: joinTranscriptWords(cueWords.map((word) => word.text)),
        wordIds: cueWords.map((word) => word.id),
        sourceStartFrame: Math.min(...cueWords.map((word) => word.startFrame)),
        sourceEndFrame: Math.max(...cueWords.map((word) => word.endFrame)),
      };
    })
    .filter((cue): cue is NonNullable<typeof cue> => cue !== null && cue.durationInFrames > 0 && cue.text.length > 0);
}

function captionPunctuationCleanupWordIds(
  words: TranscriptWord[],
  deletedWordIds: Set<string>,
): Set<string> {
  const omitted = new Set<string>();
  words.forEach((word, index) => {
    if (!deletedWordIds.has(word.id)) return;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && deletedWordIds.has(words[previousIndex].id)) previousIndex -= 1;
    let nextIndex = index + 1;
    while (nextIndex < words.length && deletedWordIds.has(words[nextIndex].id)) nextIndex += 1;
    const previous = words[previousIndex];
    const next = words[nextIndex];
    if (!previous || !next || !isPunctuationToken(previous.text) || !isPunctuationToken(next.text)) return;
    if (isTerminalPunctuation(next.text) && !isTerminalPunctuation(previous.text)) {
      omitted.add(previous.id);
      return;
    }
    omitted.add(next.id);
  });
  return omitted;
}

function isPunctuationToken(value: string): boolean {
  return /^[，。！？、,.!?；;：:…]+$/u.test(value.trim());
}

function isTerminalPunctuation(value: string): boolean {
  return /^[。！？.!?…]+$/u.test(value.trim());
}

function joinTranscriptWords(tokens: string[]): string {
  return tokens.reduce((text, token) => {
    if (!text) return token;
    return shouldInsertSpace(text[text.length - 1] ?? "", token[0] ?? "") ? `${text} ${token}` : `${text}${token}`;
  }, "");
}

function shouldInsertSpace(left: string, right: string): boolean {
  return /[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[，。！？、,.!?]/g, "");
}
