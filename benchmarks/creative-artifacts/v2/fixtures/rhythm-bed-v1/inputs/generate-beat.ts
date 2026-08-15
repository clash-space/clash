import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type BeatMap = {
  durationSeconds: number;
  sampleRate: number;
  beats: Array<{
    timeSeconds: number;
    kind: "beat" | "downbeat";
  }>;
};

function triangle(
  sample: number,
  frequency: number,
  sampleRate: number,
): number {
  const phase = (sample * frequency) % sampleRate;
  const half = Math.floor(sampleRate / 2);
  const rising = phase <= half ? phase : sampleRate - phase;
  return Math.floor((rising * 65_534) / half) - 32_767;
}

function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

async function main(): Promise<void> {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error("Usage: node inputs/generate-beat.ts <output.wav>");
  }
  const fixtureRoot = dirname(fileURLToPath(import.meta.url));
  const beatMap = JSON.parse(
    await readFile(join(fixtureRoot, "beat-map.json"), "utf8"),
  ) as BeatMap;
  const sampleCount = beatMap.durationSeconds * beatMap.sampleRate;
  const pcm = Buffer.alloc(sampleCount * 2);
  const pulseSamples = Math.floor(beatMap.sampleRate / 8);
  const beatSamples = beatMap.beats.map((beat) => ({
    sample: Math.round(beat.timeSeconds * beatMap.sampleRate),
    kind: beat.kind,
  }));

  for (let sample = 0; sample < sampleCount; sample += 1) {
    let mixed = 0;
    for (const beat of beatSamples) {
      const offset = sample - beat.sample;
      if (offset < 0 || offset >= pulseSamples) continue;
      const envelope = pulseSamples - offset;
      const frequency = beat.kind === "downbeat" ? 110 : 880;
      const gain = beat.kind === "downbeat" ? 18_000 : 10_000;
      mixed += Math.floor(
        (triangle(offset, frequency, beatMap.sampleRate) * gain * envelope) /
          (32_767 * pulseSamples),
      );
    }
    pcm.writeInt16LE(Math.max(-32_768, Math.min(32_767, mixed)), sample * 2);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    Buffer.concat([wavHeader(pcm.byteLength, beatMap.sampleRate), pcm]),
  );
}

await main();
