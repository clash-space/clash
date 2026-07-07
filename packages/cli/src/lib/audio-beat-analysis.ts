import { readFile } from "node:fs/promises";
import {
  AssetMetadataFillActionSchema,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type AnalyzeWavBeatActionOptions = {
  targetAssetId: string;
  audioPath: string;
  fps: number;
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

type WavPcm = {
  sampleRate: number;
  samples: number[];
};

type BeatSectionSummary = {
  id: string;
  startFrame: number;
  endFrame: number;
  label: string;
  energy?: number;
  novelty?: number;
  impact?: number;
  cutDensity?: "hold" | "medium" | "fast";
};

type SemanticSectionLabel =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "bridge"
  | "drop"
  | "buildup"
  | "breakdown"
  | "outro"
  | "instrumental"
  | "detected-beats"
  | "unknown";

const LOCAL_RMS_SECTION_HEURISTIC = "local-rms-phrase-heuristic";

export async function analyzeWavBeatAction(
  options: AnalyzeWavBeatActionOptions,
): Promise<AssetMetadataFillAction> {
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("fps must be a positive number");
  }
  const wav = parsePcm16Wav(await readFile(options.audioPath));
  const energies = frameRmsEnergy(wav.samples, wav.sampleRate, options.fps);
  const energyCurve = buildEnergyCurve(energies, options.fps);
  const peaks = detectBeatPeaks(energies, options.fps);
  if (peaks.length < 2) {
    throw new Error(`Not enough beat peaks detected in ${options.audioPath}`);
  }
  const bpm = estimateBpm(peaks.map((peak) => peak.frame), options.fps);
  const maxEnergy = Math.max(...energies, Number.EPSILON);
  const beats = peaks.map((peak, index) => ({
    frame: peak.frame,
    timeSeconds: round(peak.frame / options.fps),
    confidence: round(Math.min(1, peak.energy / maxEnergy)),
    bar: Math.floor(index / 4) + 1,
    beatInBar: (index % 4) + 1,
    downbeat: index % 4 === 0 || undefined,
  }));
  const beatFrameDuration = Math.max(1, Math.round((60 / bpm) * options.fps));

  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `audio-beat-analysis-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "audio.beat-analysis",
    producer: options.producer ?? "clash-production-analyze-audio-beats",
    createdAt: options.createdAt,
    metadata: {
      kind: "audio.beat-analysis",
      bpm,
      fps: options.fps,
      beats,
      sections: buildAudioSections(beats, energies.length, beatFrameDuration),
      energyCurve,
    },
  });
}

function buildAudioSections(
  beats: Array<{
    frame: number;
    confidence: number;
  }>,
  frameCount: number,
  beatFrameDuration: number,
): Array<BeatSectionSummary & {
  semanticLabel: SemanticSectionLabel;
  semanticConfidence: number;
  reviewRequired: boolean;
  semanticSource: string;
}> {
  const beatsPerBar = 4;
  if (beats.length < beatsPerBar) {
    return [
      {
        id: "detected-beats",
        startFrame: beats[0].frame,
        endFrame: Math.max(beats[beats.length - 1].frame + beatFrameDuration, frameCount),
        label: "detected-beats",
        energy: round(beats.reduce((sum, beat) => sum + beat.confidence, 0) / beats.length),
        semanticLabel: "detected-beats",
        semanticConfidence: 0.52,
        reviewRequired: true,
        semanticSource: LOCAL_RMS_SECTION_HEURISTIC,
      },
    ];
  }

  const sections: BeatSectionSummary[] = [];
  for (let beatIndex = 0; beatIndex + beatsPerBar - 1 < beats.length; beatIndex += beatsPerBar) {
    const barIndex = Math.floor(beatIndex / beatsPerBar) + 1;
    const group = beats.slice(beatIndex, beatIndex + beatsPerBar);
    const nextBarFirstBeat = beats[beatIndex + beatsPerBar];
    sections.push({
      id: `bar-${barIndex}`,
      startFrame: group[0].frame,
      endFrame: nextBarFirstBeat?.frame ?? group[group.length - 1].frame + beatFrameDuration,
      label: `bar ${barIndex}`,
      ...rhythmSummaryForBeatGroup(beats, group, group[0].frame, nextBarFirstBeat?.frame ?? group[group.length - 1].frame + beatFrameDuration),
    });
  }
  return annotateSemanticSections(sections);
}

function annotateSemanticSections(sections: BeatSectionSummary[]): Array<BeatSectionSummary & {
  semanticLabel: SemanticSectionLabel;
  semanticConfidence: number;
  reviewRequired: boolean;
  semanticSource: string;
}> {
  return sections.map((section, index) => {
    const semanticLabel = classifySemanticSection(section, index, sections);
    const semanticConfidence = confidenceForSemanticSection(semanticLabel);
    return {
      ...section,
      semanticLabel,
      semanticConfidence,
      reviewRequired: semanticConfidence < 0.8,
      semanticSource: LOCAL_RMS_SECTION_HEURISTIC,
    };
  });
}

function classifySemanticSection(
  section: BeatSectionSummary,
  index: number,
  sections: BeatSectionSummary[],
): SemanticSectionLabel {
  const energy = section.energy ?? 0;
  const novelty = section.novelty ?? 0;
  const impact = section.impact ?? Math.max(energy, novelty);
  const isFirst = index === 0;
  const isLast = index === sections.length - 1;

  if (isFirst && sections.length > 1) return "intro";
  if (impact >= 0.82 || novelty >= 0.18) return "drop";
  if (energy >= 0.68) return "chorus";
  if (novelty >= 0.12) return "buildup";
  if (isLast && sections.length > 2 && energy < 0.35) return "outro";
  if (index > 0 && !isLast) return "verse";
  return energy <= 0.2 ? "breakdown" : "instrumental";
}

function confidenceForSemanticSection(label: SemanticSectionLabel): number {
  switch (label) {
    case "drop":
      return 0.87;
    case "chorus":
      return 0.82;
    case "intro":
      return 0.72;
    case "verse":
    case "buildup":
      return 0.76;
    case "outro":
    case "instrumental":
    case "breakdown":
      return 0.68;
    case "detected-beats":
    case "pre-chorus":
    case "bridge":
    case "unknown":
      return 0.52;
  }
}

function buildEnergyCurve(energies: number[], fps: number) {
  const maxEnergy = Math.max(...energies, Number.EPSILON);
  let previousNormalized = 0;
  return energies.map((rms, frame) => {
    const normalized = round(Math.min(1, rms / maxEnergy));
    const novelty = round(Math.max(0, normalized - previousNormalized));
    previousNormalized = normalized;
    return {
      frame,
      timeSeconds: round(frame / fps),
      rms: round(rms),
      normalized,
      novelty,
      impact: round(Math.max(normalized, novelty)),
    };
  });
}

function rhythmSummaryForBeatGroup(
  allBeats: Array<{ frame: number; confidence: number }>,
  group: Array<{ frame: number; confidence: number }>,
  startFrame: number,
  endFrame: number,
) {
  const energy = round(group.reduce((sum, beat) => sum + beat.confidence, 0) / group.length);
  let noveltyTotal = 0;
  let impact = 0;
  for (const beat of group) {
    const previousBeat = previousBeatBefore(allBeats, beat.frame);
    const novelty = Math.max(0, beat.confidence - (previousBeat?.confidence ?? 0));
    noveltyTotal += novelty;
    impact = Math.max(impact, beat.confidence, novelty);
  }
  const novelty = round(noveltyTotal / group.length);
  const roundedImpact = round(impact);
  return {
    energy,
    novelty,
    impact: roundedImpact,
    cutDensity: cutDensityForSection({ energy, novelty, impact: roundedImpact, startFrame, endFrame }),
  };
}

function previousBeatBefore(
  beats: Array<{ frame: number; confidence: number }>,
  frame: number,
): { frame: number; confidence: number } | undefined {
  let previous: { frame: number; confidence: number } | undefined;
  for (const beat of beats) {
    if (beat.frame >= frame) break;
    previous = beat;
  }
  return previous;
}

function cutDensityForSection(section: {
  energy: number;
  novelty: number;
  impact: number;
  startFrame: number;
  endFrame: number;
}): "hold" | "medium" | "fast" {
  const duration = section.endFrame - section.startFrame;
  if (section.impact >= 0.75 || section.energy >= 0.75 || section.novelty >= 0.2) return "fast";
  if (section.energy >= 0.35 || duration <= 60) return "medium";
  return "hold";
}

function parsePcm16Wav(buffer: Buffer): WavPcm {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only RIFF/WAVE audio is supported by this local beat analyzer");
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(chunkDataOffset);
      channels = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
      if (audioFormat !== 1 || bitsPerSample !== 16 || channels < 1) {
        throw new Error("Only 16-bit PCM WAV audio is supported by this local beat analyzer");
      }
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || dataOffset < 0 || dataSize <= 0) {
    throw new Error("Invalid WAV file: missing fmt or data chunk");
  }

  const bytesPerSample = 2;
  const frameCount = Math.floor(dataSize / (channels * bytesPerSample));
  const samples: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const sampleOffset = dataOffset + (frame * channels + channel) * bytesPerSample;
      sum += buffer.readInt16LE(sampleOffset) / 32768;
    }
    samples.push(sum / channels);
  }
  return { sampleRate, samples };
}

function frameRmsEnergy(samples: number[], sampleRate: number, fps: number): number[] {
  const samplesPerFrame = sampleRate / fps;
  const frameCount = Math.ceil(samples.length / samplesPerFrame);
  const energies: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.min(samples.length, Math.floor((frame + 1) * samplesPerFrame));
    let sumSquares = 0;
    for (let sample = start; sample < end; sample++) {
      sumSquares += samples[sample] ** 2;
    }
    energies.push(end > start ? Math.sqrt(sumSquares / (end - start)) : 0);
  }
  return energies;
}

function detectBeatPeaks(energies: number[], fps: number): Array<{ frame: number; energy: number }> {
  const maxEnergy = Math.max(...energies, 0);
  if (maxEnergy <= 0) return [];
  const threshold = maxEnergy * 0.35;
  const minSpacingFrames = Math.max(1, Math.round(fps * 0.2));
  const peaks: Array<{ frame: number; energy: number }> = [];

  for (let frame = 0; frame < energies.length; frame++) {
    const energy = energies[frame];
    if (energy < threshold) continue;
    const previous = frame > 0 ? energies[frame - 1] : -Infinity;
    const next = frame + 1 < energies.length ? energies[frame + 1] : -Infinity;
    if (energy < previous || energy < next) continue;
    const last = peaks[peaks.length - 1];
    if (last && frame - last.frame < minSpacingFrames) {
      if (energy > last.energy) {
        last.frame = frame;
        last.energy = energy;
      }
      continue;
    }
    peaks.push({ frame, energy });
  }
  return peaks;
}

function estimateBpm(frames: number[], fps: number): number {
  const intervals = frames.slice(1).map((frame, index) => frame - frames[index]);
  const averageFrames = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  return round(60 / (averageFrames / fps));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
