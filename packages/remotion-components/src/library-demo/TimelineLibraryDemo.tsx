import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { EffectInstanceRef, Track } from '@clash/remotion-core';
import { VideoComposition } from '../VideoComposition';
import { ShaderEffectCanvas } from '../effect-demo/ShaderEffectCanvas';
import { buildTimelineLibraryDemoPlan, type TimelineLibraryDemoSegmentId } from './timelineLibraryDemoPlan';

const C = {
  paper: '#f4f1eb',
  surface: '#fffdf9',
  ink: '#1d211f',
  muted: '#77736d',
  line: '#d9d3ca',
  coral: '#ff6b50',
  coralSoft: '#ffe6df',
  blue: '#9dbef1',
  rose: '#f8a9b5',
  gold: '#d8bd77',
  dark: '#151918',
};

const sceneSvg = encodeSvg(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#efe8dc"/><stop offset="0.52" stop-color="#d9d0c3"/><stop offset="1" stop-color="#bab2a8"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf9" stop-opacity=".94"/><stop offset="1" stop-color="#e8e1d6" stop-opacity=".72"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <circle cx="1030" cy="360" r="250" fill="#ff6b50"/>
  <rect x="676" y="98" width="342" height="524" rx="22" fill="#202421" transform="rotate(-5 847 360)"/>
  <circle cx="842" cy="360" r="118" fill="none" stroke="#f4f1eb" stroke-width="3" opacity=".82"/>
  <circle cx="842" cy="360" r="76" fill="none" stroke="#f4f1eb" stroke-width="3" opacity=".62"/>
  <path d="M760 470 Q842 280 938 214" fill="none" stroke="#9dbef1" stroke-width="14"/>
  <rect x="72" y="84" width="470" height="552" rx="24" fill="url(#glass)" stroke="#c9c0b5"/>
  <text x="112" y="176" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="4" fill="#ff6b50">FIELD NOTES / 04</text>
  <text x="105" y="356" font-family="Arial,sans-serif" font-size="112" font-weight="800" letter-spacing="-8" fill="#1d211f">CUT</text>
  <text x="105" y="452" font-family="Arial,sans-serif" font-size="112" font-weight="800" letter-spacing="-8" fill="#1d211f">WITH</text>
  <text x="105" y="548" font-family="Arial,sans-serif" font-size="112" font-weight="800" letter-spacing="-8" fill="#1d211f">INTENT.</text>
  <text x="108" y="594" font-family="Arial,sans-serif" font-size="15" font-weight="600" letter-spacing="2" fill="#77736d">MOTION · COLOR · SOUND · TYPE</text>
</svg>`);

const stickerSvg = encodeSvg(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <path d="M120 14 145 70 205 52 177 108 226 142 165 151 160 213 113 173 68 217 64 155 3 148 54 112 27 57 86 72Z" fill="#9dbef1" stroke="#1d211f" stroke-width="8"/>
  <text x="120" y="139" text-anchor="middle" font-family="Arial,sans-serif" font-size="62" font-weight="900" fill="#1d211f">WOW</text>
</svg>`);

const chapterCopy: Record<TimelineLibraryDemoSegmentId, { kicker: string; title: string; detail: string }> = {
  intro: { kicker: 'CLASH · TIMELINE LIBRARY', title: 'Every edit primitive. One system.', detail: 'Typed assets, versioned effects, deterministic preview and export.' },
  motion: { kicker: 'TEXT · STICKERS', title: 'Design that lives on the timeline.', detail: 'Editable type and visual assets remain native timeline primitives.' },
  effects: { kicker: 'FX · ZOOM · ADJUSTMENTS', title: 'Stack effects. Keep control.', detail: 'Ordered, version-pinned parameters stay editable in Inspector.' },
  color: { kicker: 'LUTS · FILTERS', title: 'Color as a reversible decision.', detail: 'The same effect stack drives canvas preview and Remotion export.' },
  transitions: { kicker: 'TRANSITIONS · WEBGL2', title: 'Transitions with optical energy.', detail: 'Shader packages use two frame inputs and a typed progress contract.' },
  audio: { kicker: 'SOUND EFFECTS · AUDIO FX · CAPTIONS', title: 'Sound and words, in sync.', detail: 'SFX gets its own lane; captions keep deterministic frame timing.' },
  outro: { kicker: 'ONE CATALOG · ELEVEN CATEGORIES', title: 'Built for editors. Extensible by agents.', detail: 'Search → preview → apply → tune → render.' },
};

export const TimelineLibraryDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const plan = buildTimelineLibraryDemoPlan(fps);
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, color: C.ink, fontFamily: 'Inter, Arial, sans-serif' }}>
      {plan.segments.map((segment) => (
        <Sequence key={segment.id} from={segment.from} durationInFrames={segment.durationInFrames} premountFor={fps}>
          <SegmentShell id={segment.id} duration={segment.durationInFrames}>
            {segment.id === 'intro' ? <Intro /> : null}
            {segment.id === 'motion' ? <MotionScene duration={segment.durationInFrames} /> : null}
            {segment.id === 'effects' ? <EffectsScene duration={segment.durationInFrames} /> : null}
            {segment.id === 'color' ? <ColorScene duration={segment.durationInFrames} /> : null}
            {segment.id === 'transitions' ? <TransitionScene duration={segment.durationInFrames} /> : null}
            {segment.id === 'audio' ? <AudioScene duration={segment.durationInFrames} /> : null}
            {segment.id === 'outro' ? <Outro /> : null}
          </SegmentShell>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SegmentShell: React.FC<{ id: TimelineLibraryDemoSegmentId; duration: number; children: React.ReactNode }> = ({ id, duration, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5, duration - 5, duration - 1], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
      {id !== 'intro' && id !== 'outro' ? <ChapterHeader id={id} /> : null}
      {id !== 'intro' && id !== 'outro' ? <ProgressRail frame={frame} duration={duration} /> : null}
      <Grain />
    </AbsoluteFill>
  );
};

const ChapterHeader: React.FC<{ id: TimelineLibraryDemoSegmentId }> = ({ id }) => {
  const copy = chapterCopy[id];
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 12], [16, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 42, right: 42, top: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: '#fffdf9', transform: `translateY(${y}px)` }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.6, color: C.coral }}>{copy.kicker}</div>
        <div style={{ marginTop: 7, fontSize: 34, fontWeight: 760, letterSpacing: -1.35 }}>{copy.title}</div>
      </div>
      <div style={{ maxWidth: 360, fontSize: 14, lineHeight: 1.45, color: 'rgba(255,253,249,.72)', textAlign: 'right' }}>{copy.detail}</div>
    </div>
  );
};

const PreviewFrame: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark = true }) => (
  <div style={{ position: 'absolute', inset: '126px 42px 54px', borderRadius: 18, overflow: 'hidden', backgroundColor: dark ? C.dark : C.surface, boxShadow: '0 18px 55px rgba(25,25,22,.22)' }}>
    {children}
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 18, stiffness: 110, mass: 0.9 } });
  const categories = ['Text', 'Stickers', 'Sound FX', 'Transitions', 'FX', 'Zoom', 'LUTs', 'Audio FX', 'Captions', 'Filters', 'Adjust'];
  return (
    <AbsoluteFill style={{ padding: '54px 62px', background: `linear-gradient(135deg, ${C.paper}, #e9e3d9)` }}>
      <div style={{ color: C.coral, fontSize: 13, fontWeight: 800, letterSpacing: 3 }}>CLASH · TIMELINE LIBRARY</div>
      <div style={{ marginTop: 102, maxWidth: 1020, transform: `translateY(${(1 - reveal) * 28}px)`, opacity: reveal }}>
        <div style={{ fontSize: 84, lineHeight: .94, fontWeight: 800, letterSpacing: -5.1 }}>Every edit primitive.<br />One coherent system.</div>
        <div style={{ marginTop: 28, maxWidth: 680, fontSize: 20, color: C.muted, lineHeight: 1.5 }}>Typed assets, versioned effects and a deterministic path from Library preview to final export.</div>
      </div>
      <div style={{ position: 'absolute', left: 62, right: 62, bottom: 60, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {categories.map((label, index) => {
          const chip = interpolate(frame, [12 + index * 1.4, 20 + index * 1.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return <div key={label} style={{ opacity: chip, transform: `translateY(${(1 - chip) * 10}px)`, padding: '9px 14px', borderRadius: 999, border: `1px solid ${C.line}`, backgroundColor: C.surface, fontSize: 13, fontWeight: 650 }}>{label}</div>;
        })}
      </div>
    </AbsoluteFill>
  );
};

const MotionScene: React.FC<{ duration: number }> = ({ duration }) => {
  const tracks: Track[] = [
    { id: 'primary', name: 'Primary', role: 'primary-video', category: 'primary', items: [{ id: 'scene', type: 'image', src: sceneSvg, from: 0, durationInFrames: duration }] },
    { id: 'text', name: 'Text', role: 'subtitle', category: 'text', items: [{ id: 'headline', type: 'text', text: 'TYPE, IN MOTION', color: '#fffdf9', fontSize: 54, fontFamily: 'Arial', fontWeight: '800', from: 12, durationInFrames: duration - 12, properties: { x: 250, y: 230, width: .55, height: .18, opacity: 1 } }] },
    { id: 'sticker', name: 'Stickers', role: 'overlay', category: 'visual', items: [{ id: 'wow', type: 'sticker', src: stickerSvg, from: 20, durationInFrames: duration - 20, properties: { x: 480, y: -190, width: .13, height: .23, rotation: 8, opacity: 1 } }] },
  ];
  return <DarkScene><PreviewFrame><VideoComposition tracks={tracks} selectedItemId={null} /></PreviewFrame><LibraryBadges labels={['Editable text', 'SVG sticker']} /></DarkScene>;
};

const EffectsScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const phase = Math.min(2, Math.floor(frame / Math.max(1, Math.floor(duration / 3))));
  const stacks: Array<{ label: string; effects: EffectInstanceRef[] }> = [
    { label: 'Soft Glow', effects: [{ effectId: 'clash/soft-glow', effectVersion: 1, params: { intensity: .72 } }] },
    { label: 'Camera Shake + Punch Zoom', effects: [{ effectId: 'clash/camera-shake', effectVersion: 1, params: { intensity: 7, speed: 1.5 } }, { effectId: 'clash/punch-zoom', effectVersion: 1, params: { amount: .16 } }] },
    { label: 'Tilt Shift + Exposure', effects: [{ effectId: 'clash/tilt-shift', effectVersion: 1, params: { blur: 1.2, saturation: 1.24 } }, { effectId: 'clash/adjust-exposure', effectVersion: 1, params: { amount: .16 } }] },
  ];
  const tracks: Track[] = [{ id: 'primary', name: 'Primary', role: 'primary-video', category: 'primary', items: [{ id: 'effect-scene', type: 'image', src: sceneSvg, from: 0, durationInFrames: duration, effects: stacks[phase].effects }] }];
  return <DarkScene><PreviewFrame><VideoComposition tracks={tracks} selectedItemId={null} /></PreviewFrame><EffectStack label={stacks[phase].label} count={stacks[phase].effects.length} /></DarkScene>;
};

const ColorScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const phase = Math.min(2, Math.floor(frame / Math.max(1, Math.floor(duration / 3))));
  const looks: Array<{ label: string; effects: EffectInstanceRef[]; swatch: string }> = [
    { label: 'Warm Film', swatch: '#c98f64', effects: [{ effectId: 'clash/warm-film', effectVersion: 1, params: { intensity: .82 } }] },
    { label: 'Cool Clean', swatch: '#8db9c6', effects: [{ effectId: 'clash/cool-clean', effectVersion: 1, params: { intensity: .9 } }, { effectId: 'clash/adjust-contrast', effectVersion: 1, params: { amount: .12 } }] },
    { label: 'Monochrome', swatch: '#77736d', effects: [{ effectId: 'clash/monochrome', effectVersion: 1, params: { intensity: 1 } }] },
  ];
  const tracks: Track[] = [{ id: 'primary', name: 'Primary', role: 'primary-video', category: 'primary', items: [{ id: 'color-scene', type: 'image', src: sceneSvg, from: 0, durationInFrames: duration, effects: looks[phase].effects }] }];
  return <DarkScene><PreviewFrame><VideoComposition tracks={tracks} selectedItemId={null} /></PreviewFrame><LookStrip selected={phase} looks={looks} /></DarkScene>;
};

const TransitionScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const progress = interpolate(frame, [duration * .22, duration * .78], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const smooth = progress * progress * (3 - 2 * progress);
  return (
    <DarkScene>
      <PreviewFrame>
        <ShaderEffectCanvas effectId="clash/light-leak" params={{ intensity: .78, warmth: .82 }} progress={smooth} frame={frame} width={width} height={height} />
        <div style={{ position: 'absolute', right: 24, bottom: 22, padding: '10px 14px', borderRadius: 10, backgroundColor: 'rgba(18,20,19,.78)', color: '#fffdf9', fontFamily: 'monospace', fontSize: 13 }}>clash/light-leak@1 · WebGL2</div>
      </PreviewFrame>
      <TransitionMeter progress={smooth} />
    </DarkScene>
  );
};

const AudioScene: React.FC<{ duration: number }> = ({ duration }) => {
  const tracks: Track[] = [
    { id: 'primary', name: 'Primary', role: 'primary-video', category: 'primary', items: [{ id: 'audio-bg', type: 'image', src: sceneSvg, from: 0, durationInFrames: duration, effects: [{ effectId: 'clash/cool-clean', effectVersion: 1, params: { intensity: .35 } }] }] },
    { id: 'captions', name: 'Captions', role: 'subtitle', category: 'text', items: [{ id: 'caption', type: 'text', text: 'Ship faster with reusable Timeline building blocks.', color: '#ffffff', from: 0, durationInFrames: duration, cues: [
      { id: 'c1', startFrame: 0, durationInFrames: Math.round(duration * .46), text: 'Every sound lands on its own lane.' },
      { id: 'c2', startFrame: Math.round(duration * .46), durationInFrames: duration - Math.round(duration * .46), text: 'Every word stays frame-accurate.' },
    ], style: { fontFamily: 'Arial', fontSize: 34, fontWeight: 800, color: C.ink, backgroundColor: 'rgba(255,253,249,.9)', position: 'bottom' } }] },
    { id: 'sfx', name: 'SFX', role: 'sfx', category: 'audio', items: [{ id: 'whoosh', type: 'audio', src: staticFile('library-demo-sound.wav'), from: 0, durationInFrames: duration, volume: .82, audioFadeIn: 4, audioFadeOut: 10 }] },
  ];
  return <DarkScene><PreviewFrame><VideoComposition tracks={tracks} selectedItemId={null} /></PreviewFrame><Waveform duration={duration} /></DarkScene>;
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 20, stiffness: 100 } });
  return (
    <AbsoluteFill style={{ padding: 64, backgroundColor: C.paper }}>
      <div style={{ color: C.coral, fontSize: 13, fontWeight: 800, letterSpacing: 3 }}>ONE CATALOG · ELEVEN CATEGORIES</div>
      <div style={{ marginTop: 104, display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 90, alignItems: 'center', opacity: reveal }}>
        <div style={{ fontSize: 70, lineHeight: .98, fontWeight: 800, letterSpacing: -4.1 }}>Built for editors.<br />Extensible by agents.</div>
        <div style={{ borderTop: `1px solid ${C.line}` }}>
          {['Search + preview', 'Typed track application', 'Inspector parameters', 'Preview = export'].map((item, index) => <div key={item} style={{ display: 'flex', gap: 18, padding: '17px 0', borderBottom: `1px solid ${C.line}`, fontSize: 17, fontWeight: 650 }}><span style={{ color: C.coral, fontFamily: 'monospace' }}>0{index + 1}</span>{item}</div>)}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 58, display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 14 }}><span>CLASH TIMELINE LIBRARY</span><span style={{ fontFamily: 'monospace' }}>TEXT → MOTION → FX → COLOR → TRANSITIONS → SOUND</span></div>
    </AbsoluteFill>
  );
};

const DarkScene: React.FC<{ children: React.ReactNode }> = ({ children }) => <AbsoluteFill style={{ backgroundColor: '#171a19' }}>{children}</AbsoluteFill>;

const LibraryBadges: React.FC<{ labels: string[] }> = ({ labels }) => <div style={{ position: 'absolute', left: 64, bottom: 69, display: 'flex', gap: 8 }}>{labels.map((label) => <div key={label} style={{ padding: '8px 12px', borderRadius: 999, backgroundColor: 'rgba(255,253,249,.92)', color: C.ink, fontSize: 12, fontWeight: 700 }}>{label}</div>)}</div>;

const EffectStack: React.FC<{ label: string; count: number }> = ({ label, count }) => <div style={{ position: 'absolute', left: 64, bottom: 68, display: 'flex', alignItems: 'center', gap: 10, color: '#fffdf9' }}><div style={{ padding: '9px 13px', borderRadius: 10, backgroundColor: C.coral, fontSize: 13, fontWeight: 800 }}>EFFECT STACK</div><div style={{ padding: '9px 13px', borderRadius: 10, backgroundColor: 'rgba(255,253,249,.13)', border: '1px solid rgba(255,253,249,.18)', fontSize: 13, fontWeight: 650 }}>{label}</div><div style={{ fontFamily: 'monospace', color: 'rgba(255,253,249,.62)', fontSize: 12 }}>{count} node{count === 1 ? '' : 's'}</div></div>;

const LookStrip: React.FC<{ selected: number; looks: Array<{ label: string; swatch: string }> }> = ({ selected, looks }) => <div style={{ position: 'absolute', left: 64, bottom: 67, display: 'flex', gap: 9 }}>{looks.map((look, index) => <div key={look.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 10, color: index === selected ? C.ink : '#fffdf9', backgroundColor: index === selected ? C.surface : 'rgba(255,253,249,.12)', border: `1px solid ${index === selected ? C.surface : 'rgba(255,253,249,.16)'}`, fontSize: 12, fontWeight: 750 }}><span style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: look.swatch }} />{look.label}</div>)}</div>;

const TransitionMeter: React.FC<{ progress: number }> = ({ progress }) => <div style={{ position: 'absolute', left: 64, right: 64, bottom: 72, color: '#fffdf9' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: 2, fontWeight: 750, marginBottom: 8 }}><span>SCENE A</span><span style={{ color: C.coral }}>LIGHT LEAK</span><span>SCENE B</span></div><div style={{ height: 3, backgroundColor: 'rgba(255,253,249,.24)' }}><div style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: C.coral }} /></div></div>;

const Waveform: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const progress = frame / Math.max(1, duration - 1);
  const bars = Array.from({ length: 72 }, (_, i) => .16 + Math.abs(Math.sin(i * .71) * Math.cos(i * .19)) * .84);
  return <div style={{ position: 'absolute', left: 64, right: 64, bottom: 66, height: 42, display: 'flex', alignItems: 'center', gap: 3, padding: '0 12px', borderRadius: 11, backgroundColor: 'rgba(20,24,22,.78)', border: '1px solid rgba(255,253,249,.16)' }}>{bars.map((height, index) => <div key={index} style={{ flex: 1, height: `${height * 28}px`, borderRadius: 4, backgroundColor: index / bars.length <= progress ? C.coral : 'rgba(255,253,249,.27)' }} />)}<div style={{ marginLeft: 12, color: '#fffdf9', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>SFX · FADE OUT</div></div>;
};

const ProgressRail: React.FC<{ frame: number; duration: number }> = ({ frame, duration }) => <div style={{ position: 'absolute', left: 42, right: 42, bottom: 35, height: 2, backgroundColor: 'rgba(255,253,249,.18)' }}><div style={{ width: `${(frame / Math.max(1, duration - 1)) * 100}%`, height: '100%', backgroundColor: C.coral }} /></div>;

const Grain: React.FC = () => <AbsoluteFill style={{ pointerEvents: 'none', opacity: .13, mixBlendMode: 'soft-light', backgroundImage: 'radial-gradient(rgba(255,255,255,.42) .65px, transparent .65px)', backgroundSize: '4px 4px' }} />;

function encodeSvg(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
