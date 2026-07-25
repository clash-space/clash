/**
 * Generate waveform data from audio file
 * @param audioBuffer - Web Audio API AudioBuffer
 * @param samples - Number of samples to generate (default: 100)
 * @returns Array of normalized peak values (0-1)
 */
export function generateWaveform(audioBuffer: AudioBuffer, samples: number = 100): number[] {
  const rawData = audioBuffer.getChannelData(0); // Get first channel
  const sampleCount = Math.max(1, Math.min(samples, rawData.length || 1));
  const blockSize = Math.max(1, Math.floor(rawData.length / sampleCount));
  const waveform: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const start = blockSize * i;
    let sum = 0;
    let valuesRead = 0;

    for (let j = 0; j < blockSize && start + j < rawData.length; j++) {
      sum += Math.abs(rawData[start + j]);
      valuesRead += 1;
    }

    waveform.push(valuesRead > 0 ? sum / valuesRead : 0);
  }

  // Normalize to 0-1 range
  const max = Math.max(...waveform);
  return max > 0 ? waveform.map(v => v / max) : waveform;
}

/**
 * Load audio file and generate waveform
 * @param url - Audio file URL
 * @param samples - Number of samples
 * @returns Promise of waveform data
 */
export async function loadAudioWaveform(url: string, samples: number = 100): Promise<number[]> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load waveform source (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return generateWaveform(audioBuffer, samples);
  } finally {
    await audioContext.close();
  }
}
