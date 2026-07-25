export type EffectDemoSegment = {
  effectId: 'clash/whip-pan' | 'clash/light-leak' | 'clash/flash-through-white';
  title: string;
  description: string;
  from: number;
  duration: number;
  params: Record<string, number>;
};

export type EffectDemoPlan = {
  introDuration: number;
  effectDuration: number;
  outroDuration: number;
  effects: EffectDemoSegment[];
  outroFrom: number;
  totalFrames: number;
};

export function buildEffectDemoPlan(fps: number): EffectDemoPlan {
  const introDuration = 1.5 * fps;
  const effectDuration = 3 * fps;
  const outroDuration = 1.5 * fps;
  const specs: Array<Omit<EffectDemoSegment, 'from' | 'duration'>> = [
    {
      effectId: 'clash/whip-pan',
      title: 'Whip Pan',
      description: 'Directional travel with restrained motion blur',
      params: { intensity: 0.06, direction: -1 },
    },
    {
      effectId: 'clash/light-leak',
      title: 'Light Leak',
      description: 'Warm optical exposure with ACES tone mapping',
      params: { intensity: 0.72, warmth: 0.82 },
    },
    {
      effectId: 'clash/flash-through-white',
      title: 'Flash Through White',
      description: 'Editorial exposure cut with a soft midpoint',
      params: { intensity: 0.9, softness: 0.18 },
    },
  ];
  const effects = specs.map((spec, index) => ({
    ...spec,
    from: introDuration + index * effectDuration,
    duration: effectDuration,
  }));
  const outroFrom = introDuration + effects.length * effectDuration;
  return {
    introDuration,
    effectDuration,
    outroDuration,
    effects,
    outroFrom,
    totalFrames: outroFrom + outroDuration,
  };
}

export function effectProgress(frame: number, fps: number): number {
  const start = 1.2 * fps;
  const end = 1.8 * fps;
  const linear = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  return linear * linear * (3 - 2 * linear);
}
