import React from 'react';
import type { VideoItem } from '@clash/remotion-core';
import { colors } from '../../styles';
import type { ItemRenderProps } from '../registry';
import { secondsToFrames } from '../../utils/timeFormatter';

// Simple filmstrip cache shared by video renderers
type FilmstripCacheEntry = {
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  sampleCount: number;
  duration: number; // seconds
};

const filmstripCache = new Map<string, FilmstripCacheEntry>();

export const VideoRenderer: React.FC<ItemRenderProps> = ({ item, asset, width, height, pixelsPerFrame }) => {
  const video = item as VideoItem;

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = React.useState(false);

  // Resolve asset URL if needed (convert R2 keys to API URLs)
  const resolvedSrc = React.useMemo(() => {
    if (!('src' in video) || !video.src) return '';

    // If it's an R2 key (starts with 'projects/'), convert to API URL
    if (video.src.startsWith('projects/') || video.src.startsWith('/projects/')) {
      const cleanKey = video.src.startsWith('/') ? video.src.slice(1) : video.src;
      return `/api/assets/view/${cleanKey}`;
    }

    // Otherwise return as-is (blob:, http:, data:, etc.)
    return video.src;
  }, [video.src]);

  React.useEffect(() => {
    if (!asset?.duration || !resolvedSrc) return;

    const render = async () => {
      const duration = asset.duration!;
      const totalFrames = secondsToFrames(duration, 30); // sampling grid; not playback

      const displayWidth = Math.max(1, Math.floor(width));
      const displayHeight = Math.max(16, Math.floor(height));
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      canvas.width = displayWidth;
      canvas.height = displayHeight;
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      const ensureFilmstrip = async (): Promise<FilmstripCacheEntry> => {
        const cached = filmstripCache.get(resolvedSrc);
        if (cached && Math.abs(cached.duration - duration) < 0.001) return cached;

        const vid = document.createElement('video');
        vid.src = resolvedSrc;
        vid.crossOrigin = 'anonymous';
        vid.preload = 'metadata';
        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => resolve();
          const onError = () => reject(new Error('video metadata error'));
          vid.addEventListener('loadedmetadata', onLoaded, { once: true });
          vid.addEventListener('error', onError, { once: true });
        });

        const BASE_HEIGHT = 80;
        const frameHeight = BASE_HEIGHT;
        const frameWidth = Math.max(1, Math.floor((vid.videoWidth / vid.videoHeight) * frameHeight));
        const MAX_CACHE_FRAMES = 360;
        const sampleCount = Math.min(MAX_CACHE_FRAMES, totalFrames);
        const framesPerRow = 60;
        const rows = Math.ceil(sampleCount / framesPerRow);

        const film = document.createElement('canvas');
        film.width = frameWidth * Math.min(sampleCount, framesPerRow);
        film.height = frameHeight * rows;
        const fctx = film.getContext('2d');
        if (!fctx) throw new Error('Cannot get filmstrip context');

        const interval = duration / Math.max(sampleCount, 1);
        for (let i = 0; i < sampleCount; i++) {
          const t = Math.min(i * interval, Math.max(0, duration - 0.05));
          await new Promise<void>((resolveSeek) => {
            const onSeeked = () => { vid.removeEventListener('seeked', onSeeked); resolveSeek(); };
            vid.addEventListener('seeked', onSeeked);
            vid.currentTime = t;
          });
          const row = Math.floor(i / framesPerRow);
          const col = i % framesPerRow;
          const dx = col * frameWidth;
          const dy = row * frameHeight;
          fctx.drawImage(vid, 0, 0, vid.videoWidth, vid.videoHeight, dx, dy, frameWidth, frameHeight);
        }

        const entry: FilmstripCacheEntry = { canvas: film, frameWidth, frameHeight, framesPerRow, sampleCount, duration };
        filmstripCache.set(resolvedSrc, entry);
        return entry;
      };

      const entry = await ensureFilmstrip();
      const destFrameWidth = Math.max(1, Math.floor(entry.frameWidth * (displayHeight / entry.frameHeight)));
      const columns = Math.max(1, Math.ceil(displayWidth / destFrameWidth));
      for (let col = 0; col < columns; col++) {
        const ratio = columns === 1 ? 0 : col / (columns - 1);
        const idx = Math.min(entry.sampleCount - 1, Math.max(0, Math.round(ratio * (entry.sampleCount - 1))));
        const srcRow = Math.floor(idx / entry.framesPerRow);
        const srcCol = idx % entry.framesPerRow;
        const sx = srcCol * entry.frameWidth;
        const sy = srcRow * entry.frameHeight;
        const dx = col * destFrameWidth;
        ctx.drawImage(entry.canvas, sx, sy, entry.frameWidth, entry.frameHeight, dx, 0, destFrameWidth, displayHeight);
      }

      setReady(true);
    };

    render();
  }, [asset?.duration, resolvedSrc, width, height, pixelsPerFrame]);

  return (
    <div style={{ position: 'relative', width, height, background: colors.bg.primary }}>
      <canvas ref={canvasRef} style={{ width, height, display: 'block', opacity: ready ? 1 : 0.9 }} />
      {/* Waveform overlay if available */}
      {asset?.waveform && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.max(12, Math.floor(height * 0.4)) }}>
          <AudioWaveform waveform={asset.waveform} width={width} height={Math.max(12, Math.floor(height * 0.4))} />
        </div>
      )}
    </div>
  );
};

const AudioWaveform: React.FC<{ waveform: number[]; width: number; height: number }> = ({ waveform, width, height }) => {
  const barCount = waveform.length;
  const barWidth = width / Math.max(1, barCount);
  return (
    <svg width={width} height={height} style={{ display: 'block' }} preserveAspectRatio="none">
      {waveform.map((peak, i) => {
        const h = Math.min(peak * height, height);
        const x = i * barWidth;
        return <rect key={i} x={x} y={height - h} width={Math.max(barWidth, 1)} height={h} fill="rgba(200,200,200,0.9)" />;
      })}
    </svg>
  );
};

