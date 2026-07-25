import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ShaderEffectCanvas } from './ShaderEffectCanvas';
import { buildEffectDemoPlan, effectProgress, type EffectDemoSegment } from './effectDemoPlan';

const COLORS = {
  paper: '#f3efe8',
  ink: '#1c1e1d',
  coral: '#ff6b50',
  muted: '#726f69',
  line: '#d2ccc2',
};

export const EffectSdkDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const plan = buildEffectDemoPlan(fps);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.paper, color: COLORS.ink, fontFamily: 'Inter, sans-serif' }}>
      <Sequence from={0} durationInFrames={plan.introDuration} premountFor={fps}>
        <Intro />
      </Sequence>
      {plan.effects.map((effect) => (
        <Sequence
          key={effect.effectId}
          from={effect.from}
          durationInFrames={effect.duration}
          premountFor={fps}
        >
          <EffectSegment effect={effect} index={plan.effects.indexOf(effect)} total={plan.effects.length} />
        </Sequence>
      ))}
      <Sequence from={plan.outroFrom} durationInFrames={plan.outroDuration} premountFor={fps}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = interpolate(frame, [0, 0.8 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rule = interpolate(frame, [0.35 * fps, 1.2 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ padding: 72 }}>
      <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: 2.8, color: COLORS.coral }}>
        CLASH · CINEMATIC TRANSITIONS
      </div>
      <div style={{ marginTop: 106, maxWidth: 1040, transform: `translateY(${(1 - reveal) * 24}px)`, opacity: reveal }}>
        <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 92, lineHeight: 0.92, fontWeight: 680, letterSpacing: -5.4 }}>
          Cuts with
          <br />a point of view.
        </div>
        <div style={{ marginTop: 34, fontSize: 22, color: COLORS.muted, lineHeight: 1.45, maxWidth: 690 }}>
          Three familiar transitions, tuned for the edit instead of the effects reel.
        </div>
      </div>
      <div style={{ position: 'absolute', left: 72, right: 72, bottom: 92, height: 2, backgroundColor: COLORS.line }}>
        <div style={{ width: `${rule * 100}%`, height: '100%', backgroundColor: COLORS.coral }} />
      </div>
      <div style={{ position: 'absolute', right: 72, bottom: 54, fontFamily: '"JetBrains Mono", monospace', fontSize: 15, color: COLORS.muted }}>
        0.6 SEC · WEBGL2 · PREVIEW = EXPORT
      </div>
    </AbsoluteFill>
  );
};

const EffectSegment: React.FC<{ effect: EffectDemoSegment; index: number; total: number }> = ({
  effect,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const progress = effectProgress(frame, fps);
  const infoOpacity = interpolate(frame, [0, 0.35 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#17181d' }}>
      <ShaderEffectCanvas
        effectId={effect.effectId}
        params={effect.params}
        progress={progress}
        frame={frame}
        width={width}
        height={height}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(15,17,16,0.52), transparent 24%, transparent 72%, rgba(15,17,16,0.58))', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 48, top: 38, color: '#fffaf2', opacity: infoOpacity }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontSize: 13, letterSpacing: 2.4, fontWeight: 700 }}>
          <span style={{ color: COLORS.coral }}>0{index + 1}</span>
          <span>CURATED TRANSITION</span>
        </div>
        <div style={{ marginTop: 8, fontFamily: '"Space Grotesk", sans-serif', fontSize: 42, fontWeight: 650, letterSpacing: -1.8 }}>
          {effect.title}
        </div>
        <div style={{ marginTop: 3, fontSize: 15, color: 'rgba(255,250,242,0.72)', letterSpacing: 0.2 }}>{effect.description}</div>
      </div>
      <div style={{ position: 'absolute', right: 48, top: 40, color: 'rgba(255,250,242,0.76)', fontFamily: '"JetBrains Mono", monospace', fontSize: 12, letterSpacing: 1.5, textAlign: 'right' }}>
        <div>{effect.effectId}@1</div>
        <div style={{ marginTop: 6, color: COLORS.coral }}>0.6 SEC</div>
      </div>
      <TimelineMeter frame={frame} duration={durationInFrames} progress={progress} index={index} total={total} />
    </AbsoluteFill>
  );
};

const TimelineMeter: React.FC<{ frame: number; duration: number; progress: number; index: number; total: number }> = ({
  frame,
  duration,
  progress,
  index,
  total,
}) => {
  const playhead = (frame / Math.max(1, duration - 1)) * 100;
  return (
    <div style={{ position: 'absolute', left: 48, right: 48, bottom: 34, color: '#fffaf2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: 1.7 }}>
        <span>SCENE A</span>
        <span style={{ color: 'rgba(255,250,242,0.64)' }}>{index + 1} / {total}</span>
        <span>SCENE B</span>
      </div>
      <div style={{ position: 'relative', height: 2, backgroundColor: 'rgba(255,250,242,0.36)' }}>
        <div style={{ width: `${Math.max(progress, 0.015) * 100}%`, height: '100%', backgroundColor: COLORS.coral }} />
        <div style={{ position: 'absolute', left: `${playhead}%`, top: -4, width: 1, height: 10, backgroundColor: '#fffaf2' }} />
      </div>
    </div>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = interpolate(frame, [0, 0.75 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lines = [
    'clash effect create agent/new-transition',
    'clash effect validate .',
    'clash effect pack .',
    'clash effect install ./agent-new-transition-1.clash-effect.json',
  ];
  return (
    <AbsoluteFill style={{ padding: 72 }}>
      <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: 2.8, color: COLORS.coral }}>A SYSTEM, NOT A GRAB BAG</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 82, alignItems: 'center', flex: 1, opacity: reveal }}>
        <div>
          <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 70, lineHeight: 0.96, fontWeight: 680, letterSpacing: -4.1 }}>
            Curated first.<br />Agent-extensible<br />by design.
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${COLORS.line}` }}>
          {lines.map((line, index) => (
            <div key={line} style={{ display: 'flex', gap: 18, padding: '18px 0', borderBottom: `1px solid ${COLORS.line}`, fontFamily: '"JetBrains Mono", monospace', fontSize: 16 }}>
              <span style={{ color: COLORS.coral }}>{String(index + 1).padStart(2, '0')}</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 15, color: COLORS.muted, letterSpacing: 0.4 }}>CATALOG → PROVENANCE → VALIDATE → PREVIEW → EXPORT</div>
    </AbsoluteFill>
  );
};
