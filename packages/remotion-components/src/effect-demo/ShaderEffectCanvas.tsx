import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { compileEffect } from '@clash/remotion-effects';
import { getBuiltInShaderSource, resolveBuiltInShaderEffect } from '@clash/remotion-effects/shader-effects';
import { WebGlEffectRuntime } from '@clash/remotion-effects/webgl';

export type ShaderEffectCanvasProps = {
  effectId: string;
  params: Record<string, number>;
  progress: number;
  frame: number;
  width: number;
  height: number;
};

export function computeShaderFallbackFrame(
  effectId: string,
  progress: number,
  params: Record<string, number>,
): { blend: number; flash: number; leak: number; travel: number } {
  const clamped = Math.min(1, Math.max(0, progress));
  const smooth = clamped * clamped * (3 - 2 * clamped);
  const envelope = Math.sin(smooth * Math.PI);
  return {
    blend: smooth,
    flash: effectId === 'clash/flash-through-white' ? envelope * (params.intensity ?? 0.9) : 0,
    leak: effectId === 'clash/light-leak' ? envelope * (params.intensity ?? 0.72) : 0,
    travel: effectId === 'clash/whip-pan' ? smooth * (params.direction ?? 1) : 0,
  };
}

export const ShaderEffectCanvas: React.FC<ShaderEffectCanvasProps> = ({
  effectId,
  params,
  progress,
  frame,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<WebGlEffectRuntime | null>(null);
  const sourceCanvasesRef = useRef<{ from: HTMLCanvasElement; to: HTMLCanvasElement } | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const fallbackCanvas = fallbackCanvasRef.current;
    if (!canvas || !fallbackCanvas) return;
    if (!sourceCanvasesRef.current) {
      sourceCanvasesRef.current = {
        from: document.createElement('canvas'),
        to: document.createElement('canvas'),
      };
    }
    const sources = sourceCanvasesRef.current;
    for (const source of Object.values(sources)) {
      source.width = width;
      source.height = height;
    }
    paintSourceScene(sources.from, 'from', frame, width, height);
    paintSourceScene(sources.to, 'to', frame, width, height);

    // Always paint the deterministic Canvas2D fallback first. The WebGL canvas
    // is transparent until a GPU draw succeeds, so headless render workers
    // without WebGL2 still export the same transition instead of aborting.
    paintFallbackTransition(
      fallbackCanvas,
      sources.from,
      sources.to,
      effectId,
      progress,
      params,
      width,
      height,
    );

    if (!runtimeRef.current) {
      try {
        runtimeRef.current = new WebGlEffectRuntime({ canvas, resolveShader: getBuiltInShaderSource });
      } catch {
        return;
      }
    }

    const definition = resolveBuiltInShaderEffect(effectId);
    const plan = compileEffect({
      definition,
      renderer: 'webgl2',
      inputs: { from: 'demo-scene-a', to: 'demo-scene-b' },
      params,
      progress,
      frame,
      width,
      height,
    });
    try {
      runtimeRef.current.render({ plan, sources });
    } catch {
      runtimeRef.current.dispose();
      runtimeRef.current = null;
    }
  }, [effectId, frame, height, params, progress, width]);

  useEffect(() => () => {
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={fallbackCanvasRef} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={canvasRef} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
};

function paintFallbackTransition(
  canvas: HTMLCanvasElement,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  effectId: string,
  progress: number,
  params: Record<string, number>,
  width: number,
  height: number,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const state = computeShaderFallbackFrame(effectId, progress, params);
  context.clearRect(0, 0, width, height);

  if (effectId === 'clash/whip-pan') {
    const direction = params.direction && params.direction < 0 ? -1 : 1;
    const fromX = state.blend * width * 1.08 * direction;
    const toX = -(1 - state.blend) * width * 1.08 * direction;
    context.globalAlpha = 1;
    context.drawImage(from, fromX, 0, width, height);
    context.drawImage(to, toX, 0, width, height);
    context.globalAlpha = Math.sin(state.blend * Math.PI) * 0.14;
    context.fillStyle = '#fffdf9';
    for (let offset = -80; offset <= 80; offset += 20) context.fillRect(0, height / 2 + offset, width, 2);
    context.globalAlpha = 1;
    return;
  }

  context.globalAlpha = 1;
  context.drawImage(from, 0, 0, width, height);
  context.globalAlpha = state.blend;
  context.drawImage(to, 0, 0, width, height);
  context.globalAlpha = 1;

  if (state.flash > 0) {
    context.fillStyle = `rgba(255,255,255,${Math.min(1, state.flash)})`;
    context.fillRect(0, 0, width, height);
  }
  if (state.leak > 0) {
    const gradient = context.createRadialGradient(width * 1.04, -height * 0.08, 0, width * 1.04, -height * 0.08, width * 0.92);
    gradient.addColorStop(0, `rgba(255,243,214,${Math.min(1, state.leak)})`);
    gradient.addColorStop(.32, `rgba(255,166,76,${Math.min(.84, state.leak * .74)})`);
    gradient.addColorStop(1, 'rgba(255,107,80,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
}

function paintSourceScene(
  canvas: HTMLCanvasElement,
  scene: 'from' | 'to',
  frame: number,
  width: number,
  height: number,
): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable for shader demo inputs.');
  context.clearRect(0, 0, width, height);

  if (scene === 'from') {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#efe9df');
    gradient.addColorStop(0.58, '#ded7ca');
    gradient.addColorStop(1, '#c9c1b4');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(31, 35, 32, 0.13)';
    context.lineWidth = 1;
    for (let x = 72; x < width; x += 152) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    const drift = Math.sin(frame / 36) * 14;
    context.fillStyle = '#ff6b50';
    context.beginPath();
    context.arc(width * 0.79 + drift, height * 0.5, 238, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.translate(width * 0.69, height * 0.49);
    context.rotate(-0.09 + Math.sin(frame / 42) * 0.012);
    context.fillStyle = '#1d211f';
    roundedRect(context, -170, -238, 340, 476, 4);
    context.fill();
    context.strokeStyle = 'rgba(245, 239, 229, 0.78)';
    context.lineWidth = 2;
    for (let index = 0; index < 4; index += 1) {
      context.beginPath();
      context.arc(0, 0, 48 + index * 32, -0.5, Math.PI * 1.35);
      context.stroke();
    }
    context.restore();

    context.fillStyle = '#1d211f';
    context.font = '650 118px "Space Grotesk", sans-serif';
    context.letterSpacing = '-7px';
    context.fillText('FORM', 74, height * 0.55);
    context.font = '600 18px "Inter", sans-serif';
    context.letterSpacing = '3.2px';
    context.fillText('FIELD NOTES / 01', 80, height * 0.65);
    context.fillStyle = 'rgba(29, 33, 31, 0.65)';
    context.font = '500 15px "Inter", sans-serif';
    context.letterSpacing = '1.2px';
    context.fillText('MOTION STUDIES · OBJECT & SPACE', 80, height * 0.7);
  } else {
    const gradient = context.createLinearGradient(width, 0, 0, height);
    gradient.addColorStop(0, '#283a34');
    gradient.addColorStop(0.55, '#182521');
    gradient.addColorStop(1, '#101614');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const drift = Math.sin(frame / 38) * 11;
    context.save();
    context.translate(width * 0.28 + drift, height * 0.48);
    context.rotate(0.08 - Math.sin(frame / 45) * 0.01);
    context.fillStyle = '#ebe2d4';
    roundedRect(context, -176, -244, 352, 488, 4);
    context.fill();
    context.strokeStyle = '#ff6b50';
    context.lineWidth = 14;
    context.beginPath();
    context.moveTo(-102, 152);
    context.lineTo(112, -168);
    context.stroke();
    context.restore();

    context.fillStyle = '#ff6b50';
    context.fillRect(width * 0.47, height * 0.66, width * 0.39, 8);
    context.fillStyle = '#f4eee4';
    context.font = '650 106px "Space Grotesk", sans-serif';
    context.letterSpacing = '-6px';
    context.fillText('RHYTHM', width * 0.44, height * 0.52);
    context.font = '600 18px "Inter", sans-serif';
    context.letterSpacing = '3.2px';
    context.fillText('FIELD NOTES / 02', width * 0.445, height * 0.61);
    context.fillStyle = 'rgba(244, 238, 228, 0.62)';
    context.font = '500 15px "Inter", sans-serif';
    context.letterSpacing = '1.2px';
    context.fillText('CUT, PACE & OPTICAL ENERGY', width * 0.445, height * 0.655);
  }

  paintGrain(context, width, height);
}

function paintGrain(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.globalAlpha = 0.075;
  context.fillStyle = '#ffffff';
  for (let index = 0; index < 180; index += 1) {
    const x = (index * 197.3) % width;
    const y = (index * index * 23.7) % height;
    context.fillRect(x, y, 1.25, 1.25);
  }
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
