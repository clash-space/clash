const DEFAULT_SAMPLES_PER_SECOND = 96;
const MIN_WAVEFORM_SAMPLES = 1024;
const MAX_WAVEFORM_SAMPLES = 8192;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatCoordinate(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function getWaveformSampleCount(durationSeconds: number): number {
  const duration = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
  return clamp(
    Math.ceil(duration * DEFAULT_SAMPLES_PER_SECOND),
    MIN_WAVEFORM_SAMPLES,
    MAX_WAVEFORM_SAMPLES,
  );
}

export function getWaveformBuildCacheKey(
  mediaType: string | undefined,
  source: string | undefined,
  sampleCount: number,
): string | null {
  return source && (mediaType === 'audio' || mediaType === 'video')
    ? `${mediaType}:${source}:${sampleCount}`
    : null;
}

export function createOneSidedWaveformPath(options: {
  waveform: number[];
  width: number;
  height: number;
  volume: number;
}): string {
  const { waveform } = options;
  if (waveform.length === 0 || options.width <= 0 || options.height <= 0) {
    return '';
  }

  const baselineY = options.height;
  const points = waveform.map((peak, index) => {
    const ratio = waveform.length === 1 ? 0 : index / (waveform.length - 1);
    const x = ratio * options.width;
    const amplitude = clamp(peak * options.volume, 0, 1) * options.height;
    return {
      x,
      y: baselineY - amplitude,
    };
  });
  if (points.length === 1) {
    points.push({ ...points[0]!, x: options.width });
  }

  const area = points.map((point) => (
    `L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`
  ));
  return [
    `M 0 ${formatCoordinate(baselineY)}`,
    ...area,
    `L ${formatCoordinate(options.width)} ${formatCoordinate(baselineY)}`,
    'Z',
  ].join(' ');
}
