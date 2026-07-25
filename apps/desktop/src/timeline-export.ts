import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';

type TimelineRenderDsl = {
  tracks?: unknown;
  compositionWidth?: unknown;
  compositionHeight?: unknown;
  fps?: unknown;
  durationInFrames?: unknown;
};

export type DesktopTimelineExportRequest = {
  timelineName: string;
  timeline: TimelineRenderDsl;
};

type TimelineInputProps = {
  tracks: unknown[];
  compositionWidth: number;
  compositionHeight: number;
  fps: number;
  durationInFrames: number;
};

type RemotionRenderer = {
  selectComposition: (options: Record<string, unknown>) => Promise<unknown>;
  renderMedia: (options: Record<string, unknown>) => Promise<unknown>;
};

let cachedBundlePath: string | null = null;

function positiveNumber(value: unknown, fallback: number, label: string): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    throw new Error(`Timeline export requires a positive ${label}.`);
  }
  return candidate;
}

export function safeVideoExportName(name: string): string {
  const safe = name.trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return `${safe || 'timeline'}.mp4`;
}

export function timelineRenderInput(timeline: TimelineRenderDsl): TimelineInputProps {
  if (!Array.isArray(timeline.tracks)) {
    throw new Error('Timeline export requires a tracks array.');
  }
  return {
    tracks: timeline.tracks,
    compositionWidth: positiveNumber(timeline.compositionWidth, 1920, 'composition width'),
    compositionHeight: positiveNumber(timeline.compositionHeight, 1080, 'composition height'),
    fps: positiveNumber(timeline.fps, 30, 'fps'),
    durationInFrames: positiveNumber(timeline.durationInFrames, 300, 'duration'),
  };
}

export async function resolveDesktopRemotionBundle({
  moduleDir,
  isPackaged,
  resourcesPath,
}: {
  moduleDir: string;
  isPackaged: boolean;
  resourcesPath: string;
}): Promise<string> {
  if (cachedBundlePath && existsSync(cachedBundlePath)) return cachedBundlePath;

  const packagedBundle = join(resourcesPath, 'remotion-bundle');
  if (isPackaged) {
    if (!existsSync(packagedBundle)) {
      throw new Error('The packaged Remotion render bundle is missing. Reinstall Clash and try again.');
    }
    cachedBundlePath = packagedBundle;
    return packagedBundle;
  }

  const entryPoint = resolve(moduleDir, '../../../packages/remotion-components/src/Root.tsx');
  if (!existsSync(entryPoint)) {
    throw new Error(`Remotion entry point not found: ${entryPoint}`);
  }
  const { bundle } = await import('@remotion/bundler');
  cachedBundlePath = await bundle({ entryPoint });
  return cachedBundlePath;
}

export async function renderTimelineVideo({
  timeline,
  outputPath,
  serveUrl,
  renderer,
}: {
  timeline: TimelineRenderDsl;
  outputPath: string;
  serveUrl: string;
  renderer?: RemotionRenderer;
}): Promise<void> {
  const inputProps = timelineRenderInput(timeline);
  const activeRenderer = renderer ?? await import('@remotion/renderer') as unknown as RemotionRenderer;
  const composition = await activeRenderer.selectComposition({
    serveUrl,
    id: 'VideoComposition',
    inputProps,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await activeRenderer.renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
  });
}

export function createDesktopTimelineRenderer(options: {
  moduleDir: string;
  isPackaged: boolean;
  resourcesPath: string;
}) {
  return {
    async render(input: {
      timelineDsl: Record<string, any>;
      taskId: string;
      projectId: string;
    }) {
      const serveUrl = await resolveDesktopRemotionBundle(options);
      const outputDir = await mkdtemp(join(tmpdir(), 'clash-timeline-render-'));
      const outputPath = join(outputDir, `${input.taskId}.mp4`);
      try {
        await renderTimelineVideo({
          timeline: input.timelineDsl,
          outputPath,
          serveUrl,
        });
        const metadata = timelineRenderInput(input.timelineDsl);
        return {
          bytes: await readFile(outputPath),
          contentType: 'video/mp4',
          width: metadata.compositionWidth,
          height: metadata.compositionHeight,
          durationMs: Math.round((metadata.durationInFrames * 1000) / metadata.fps),
        };
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
  };
}
