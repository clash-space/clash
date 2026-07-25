import type { AudioDuckingSettings, Track } from './types';

export const AUDIO_GAIN_DB_MIN = -60;
export const AUDIO_GAIN_DB_MAX = 12;

export type AudioGainFields = {
  audioGainDb?: number;
  audioFadeInFrames?: number;
  audioFadeOutFrames?: number;
  /** @deprecated Read-only compatibility with timelines authored before audioGainDb. */
  volume?: number;
  /** @deprecated Read-only compatibility with timelines authored before audioFadeInFrames. */
  audioFadeIn?: number;
  /** @deprecated Read-only compatibility with timelines authored before audioFadeOutFrames. */
  audioFadeOut?: number;
};

const finiteNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

export const clampAudioGainDb = (value: number): number => (
  Math.max(AUDIO_GAIN_DB_MIN, Math.min(AUDIO_GAIN_DB_MAX, value))
);

export const audioGainDbToLinear = (value: number): number => {
  const db = clampAudioGainDb(value);
  return db <= AUDIO_GAIN_DB_MIN ? 0 : 10 ** (db / 20);
};

export const linearAudioGainToDb = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return AUDIO_GAIN_DB_MIN;
  return clampAudioGainDb(20 * Math.log10(value));
};

export const resolveAudioGainDb = (item: object): number => {
  const fields = item as AudioGainFields;
  const canonical = finiteNumber(fields.audioGainDb);
  if (canonical !== undefined) return clampAudioGainDb(canonical);

  const legacy = finiteNumber(fields.volume);
  return legacy === undefined ? 0 : linearAudioGainToDb(legacy);
};

export const resolveLinearAudioGain = (item: object): number => {
  const fields = item as AudioGainFields;
  const canonical = finiteNumber(fields.audioGainDb);
  if (canonical !== undefined) return audioGainDbToLinear(canonical);

  const legacy = finiteNumber(fields.volume);
  return legacy === undefined ? 1 : Math.max(0, legacy);
};

const resolveFadeFrames = (canonical: unknown, legacy: unknown): number => {
  const canonicalFrames = finiteNumber(canonical);
  if (canonicalFrames !== undefined) return Math.max(0, canonicalFrames);

  const legacyFrames = finiteNumber(legacy);
  return legacyFrames === undefined ? 0 : Math.max(0, legacyFrames);
};

export const resolveAudioFadeInFrames = (item: object): number => (
  resolveFadeFrames(
    (item as AudioGainFields).audioFadeInFrames,
    (item as AudioGainFields).audioFadeIn,
  )
);

export const resolveAudioFadeOutFrames = (item: object): number => (
  resolveFadeFrames(
    (item as AudioGainFields).audioFadeOutFrames,
    (item as AudioGainFields).audioFadeOut,
  )
);

export type AudioDuckingWindow = {
  from: number;
  end: number;
};

export const DEFAULT_AUDIO_DUCKING_SETTINGS: Readonly<AudioDuckingSettings> = {
  amountDb: -18,
  attackFrames: 6,
  releaseFrames: 12,
};

const SPOKEN_TRACK_ROLES = new Set(['narration', 'dialogue', 'primary-video']);

/** Composition-absolute windows containing known spoken media. */
export const buildAudioDuckingWindows = (tracks: readonly Track[]): AudioDuckingWindow[] => (
  tracks
    .filter((track) => !track.hidden && track.role && SPOKEN_TRACK_ROLES.has(track.role))
    .flatMap((track) => track.items
      .filter((item) => item.type === 'audio' || item.type === 'video')
      .filter((item) => resolveLinearAudioGain(item) > 0)
      .map((item) => ({
        from: item.from,
        end: item.from + item.durationInFrames,
      })))
    .filter((window) => window.end > window.from)
    .sort((a, b) => a.from - b.from || a.end - b.end)
);

export const computeAudioDuckingMultiplier = (
  settings: AudioDuckingSettings | undefined,
  compositionFrame: number,
  windows: readonly AudioDuckingWindow[],
): number => {
  if (!settings) return 1;
  const amountDb = Math.max(
    AUDIO_GAIN_DB_MIN,
    Math.min(0, finiteNumber(settings.amountDb) ?? -18),
  );
  const attackFrames = Math.max(0, Math.floor(finiteNumber(settings.attackFrames) ?? 0));
  const releaseFrames = Math.max(0, Math.floor(finiteNumber(settings.releaseFrames) ?? 0));
  let activeAmountDb = 0;

  for (const window of windows) {
    let windowAmountDb = 0;
    if (compositionFrame < window.from) {
      if (attackFrames > 0 && compositionFrame >= window.from - attackFrames) {
        const progress = (compositionFrame - (window.from - attackFrames)) / attackFrames;
        windowAmountDb = amountDb * progress;
      }
    } else if (compositionFrame < window.end) {
      windowAmountDb = amountDb;
    } else if (releaseFrames > 0 && compositionFrame <= window.end + releaseFrames) {
      const progress = (compositionFrame - window.end) / releaseFrames;
      windowAmountDb = amountDb * (1 - progress);
    }
    activeAmountDb = Math.min(activeAmountDb, windowAmountDb);
  }

  return audioGainDbToLinear(activeAmountDb);
};
