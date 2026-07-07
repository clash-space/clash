import {
  AssetMetadataFillActionSchema,
  AudioBeatMetadataSchema,
  type AssetMetadataFillAction,
  type AudioBeatMetadata,
} from "@clash/shared-types";

export type PlanLyricsAlignmentActionOptions = {
  targetAssetId: string;
  lyricsText: string;
  beatAction: AssetMetadataFillAction;
  lyricsSource?: string;
  vocalStemAssetId?: string;
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export function planLyricsAlignmentAction(
  options: PlanLyricsAlignmentActionOptions,
): AssetMetadataFillAction {
  if (!options.targetAssetId.trim()) {
    throw new Error("target asset id is required");
  }
  if (options.beatAction.targetAssetId !== options.targetAssetId) {
    throw new Error(`beat action target ${options.beatAction.targetAssetId} does not match ${options.targetAssetId}`);
  }
  if (options.beatAction.metadata.kind !== "audio.beat-analysis") {
    throw new Error(`plan-lyrics-alignment requires audio.beat-analysis metadata, got ${options.beatAction.metadata.kind}`);
  }
  const metadata = AudioBeatMetadataSchema.parse(options.beatAction.metadata);
  const lines = parseLyricsLines(options.lyricsText);
  const ranges = assignLinesToBeatRanges(lines.length, metadata);
  const units = lines.map((text, index) => {
    const range = ranges[index];
    return {
      lineId: `line-${index + 1}`,
      text,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      startMs: frameToMs(range.startFrame, metadata.fps),
      endMs: frameToMs(range.endFrame, metadata.fps),
      confidence: range.confidence,
      source: range.source,
    };
  });
  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `lyrics-alignment-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "audio.lyrics-alignment",
    producer: options.producer ?? "clash-production-plan-lyrics-alignment",
    createdAt: options.createdAt,
    metadata: {
      kind: "audio.lyrics-alignment",
      fps: metadata.fps,
      lyricsSource: options.lyricsSource ?? "lyrics.txt",
      vocalStemAssetId: options.vocalStemAssetId,
      units,
      unmatchedRanges: [],
    },
  });
}

function parseLyricsLines(lyricsText: string): string[] {
  const lines = lyricsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new Error("lyrics file has no non-empty lyric lines");
  }
  return lines;
}

function assignLinesToBeatRanges(
  lineCount: number,
  metadata: AudioBeatMetadata,
): Array<{
  startFrame: number;
  endFrame: number;
  confidence: number;
  source: "beat-section-heuristic" | "even-duration-heuristic";
}> {
  if (metadata.sections.length >= lineCount) {
    return metadata.sections.slice(0, lineCount).map((section) => ({
      startFrame: section.startFrame,
      endFrame: Math.max(section.startFrame + 1, section.endFrame),
      confidence: 0.62,
      source: "beat-section-heuristic",
    }));
  }

  const totalFrames = inferTotalFrames(metadata, lineCount);
  return Array.from({ length: lineCount }, (_, index) => {
    const startFrame = Math.round((index / lineCount) * totalFrames);
    const endFrame = Math.max(startFrame + 1, Math.round(((index + 1) / lineCount) * totalFrames));
    return {
      startFrame,
      endFrame,
      confidence: 0.45,
      source: "even-duration-heuristic",
    };
  });
}

function inferTotalFrames(metadata: AudioBeatMetadata, lineCount: number): number {
  const sectionEnd = metadata.sections.reduce((end, section) => Math.max(end, section.endFrame), 0);
  const beatEnd = metadata.beats.reduce((end, beat) => Math.max(end, beat.frame), 0);
  const beatStep = inferBeatStep(metadata);
  return Math.max(1, sectionEnd, beatEnd + beatStep, Math.round(metadata.fps * lineCount));
}

function inferBeatStep(metadata: AudioBeatMetadata): number {
  const frames = metadata.beats.map((beat) => beat.frame).sort((a, b) => a - b);
  const deltas = frames.slice(1).map((frame, index) => frame - frames[index]).filter((delta) => delta > 0);
  if (deltas.length === 0) return Math.round(metadata.fps);
  return Math.max(1, Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length));
}

function frameToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}
