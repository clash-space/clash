export type EffectKind =
  | 'clip-effect'
  | 'transition'
  | 'generator'
  | 'mask'
  | 'composite';

export type RendererKind = 'css' | 'webgl2' | 'webgpu' | 'remotion' | 'ffmpeg';
export type EffectInputType = 'texture' | 'video' | 'image' | 'mask';
export type EffectInputDefinition = {
  type: EffectInputType;
  required: boolean;
};

export type NumberParamDefinition = {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  keyframable?: boolean;
};

export type BooleanParamDefinition = {
  type: 'boolean';
  default: boolean;
  keyframable?: boolean;
};

export type EnumParamDefinition<T extends readonly string[] = readonly string[]> = {
  type: 'enum';
  default: T[number];
  values: T;
  keyframable?: boolean;
};

export type Vec2ParamDefinition = {
  type: 'vec2';
  default: readonly [number, number];
  min?: number;
  max?: number;
  keyframable?: boolean;
};

export type ColorParamDefinition = {
  type: 'color';
  default: string;
  keyframable?: boolean;
};

export type EffectParamDefinition =
  | NumberParamDefinition
  | BooleanParamDefinition
  | EnumParamDefinition
  | Vec2ParamDefinition
  | ColorParamDefinition;

export type EffectParamSchema = Record<string, EffectParamDefinition>;

type InferParamValue<T extends EffectParamDefinition> =
  T extends NumberParamDefinition ? number
    : T extends BooleanParamDefinition ? boolean
      : T extends EnumParamDefinition<infer Values> ? Values[number]
        : T extends Vec2ParamDefinition ? readonly [number, number]
          : T extends ColorParamDefinition ? string
            : never;

export type InferEffectParams<Schema extends EffectParamSchema> = {
  [Key in keyof Schema]: InferParamValue<Schema[Key]>;
};

export type EffectUniformValue = number | readonly number[];
export type EffectUniforms = Record<string, EffectUniformValue>;

export type EffectPassContext<Schema extends EffectParamSchema> = {
  params: InferEffectParams<Schema>;
  progress: number;
  frame: number;
  width: number;
  height: number;
};

export type ShaderPassDefinition<Schema extends EffectParamSchema> = {
  kind: 'shader';
  shader: string;
  uniforms?: (context: EffectPassContext<Schema>) => EffectUniforms;
};

export type EffectPassDefinition<Schema extends EffectParamSchema> =
  ShaderPassDefinition<Schema>;

export type EffectPresentationRole = 'from' | 'to';
export type EffectPresentationStyle = Record<string, string | number | undefined>;

export type EffectProvenance = {
  provider: 'clash' | 'chatcut' | 'hyperframes' | 'remotion' | 'community';
  upstreamId?: string;
  sourceUrl?: string;
  license?: string;
  adapted?: boolean;
};

export type EffectDefinition<Schema extends EffectParamSchema = EffectParamSchema> = {
  id: string;
  version: number;
  kind: EffectKind;
  inputs: Record<string, EffectInputDefinition>;
  params: Schema;
  capabilities: Partial<Record<RendererKind, boolean>>;
  passes: EffectPassDefinition<Schema>[];
  fallback?: { effectId: string; version: number };
  provenance?: EffectProvenance;
  presentation?: (context: EffectPassContext<Schema> & {
    role: EffectPresentationRole;
  }) => EffectPresentationStyle;
};

export type CompiledShaderPass = {
  kind: 'shader';
  shader: string;
  uniforms: EffectUniforms;
};

export type CompiledEffect = {
  effectId: string;
  effectVersion: number;
  renderer: RendererKind;
  inputs: Record<string, string>;
  params: Record<string, unknown>;
  progress: number;
  frame: number;
  width: number;
  height: number;
  passes: CompiledShaderPass[];
};

export function numberParam(options: Omit<NumberParamDefinition, 'type'>): NumberParamDefinition {
  return { type: 'number', ...options };
}

export function booleanParam(options: Omit<BooleanParamDefinition, 'type'>): BooleanParamDefinition {
  return { type: 'boolean', ...options };
}

export function enumParam<const Values extends readonly string[]>(
  options: Omit<EnumParamDefinition<Values>, 'type'>,
): EnumParamDefinition<Values> {
  return { type: 'enum', ...options };
}

export function vec2Param(options: Omit<Vec2ParamDefinition, 'type'>): Vec2ParamDefinition {
  return { type: 'vec2', ...options };
}

export function colorParam(options: Omit<ColorParamDefinition, 'type'>): ColorParamDefinition {
  return { type: 'color', ...options };
}

export function textureInput(options: { required?: boolean } = {}): EffectInputDefinition {
  return { type: 'texture', required: options.required ?? true };
}

export function defineEffect<const Schema extends EffectParamSchema>(
  definition: EffectDefinition<Schema>,
): EffectDefinition<Schema> {
  validateDefinition(definition);
  return definition;
}

function validateDefinition<Schema extends EffectParamSchema>(definition: EffectDefinition<Schema>): void {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(definition.id)) {
    throw new Error(`Effect id "${definition.id}" must use a namespaced lower-case id.`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Effect "${definition.id}" version must be a positive integer.`);
  }
  for (const [name, param] of Object.entries(definition.params)) {
    validateParamDefinition(name, param);
  }
  for (const pass of definition.passes) {
    if (!pass.shader.trim()) {
      throw new Error(`Effect "${definition.id}" has a shader pass without a shader id.`);
    }
  }
}

function validateParamDefinition(name: string, param: EffectParamDefinition): void {
  if (param.type === 'number') {
    if (!Number.isFinite(param.default)) {
      throw new Error(`Parameter default for "${name}" must be finite.`);
    }
    if (param.min != null && param.max != null && param.min > param.max) {
      throw new Error(`Parameter range for "${name}" is invalid.`);
    }
    if (param.min != null && param.default < param.min) {
      throw new Error(`Parameter default for "${name}" is below its minimum.`);
    }
    if (param.max != null && param.default > param.max) {
      throw new Error(`Parameter default for "${name}" is above its maximum.`);
    }
  }
  if (param.type === 'enum' && !param.values.includes(param.default)) {
    throw new Error(`Parameter default for "${name}" is not an allowed enum value.`);
  }
  if (param.type === 'vec2') {
    for (const component of param.default) {
      if (!Number.isFinite(component)) {
        throw new Error(`Parameter default for "${name}" must contain finite numbers.`);
      }
      if (param.min != null && component < param.min) {
        throw new Error(`Parameter default for "${name}" is below its minimum.`);
      }
      if (param.max != null && component > param.max) {
        throw new Error(`Parameter default for "${name}" is above its maximum.`);
      }
    }
  }
}

export class EffectRegistry {
  private readonly definitions = new Map<string, EffectDefinition>();

  register<const Schema extends EffectParamSchema>(definition: EffectDefinition<Schema>): this {
    validateDefinition(definition);
    const key = effectKey(definition.id, definition.version);
    if (this.definitions.has(key)) {
      throw new Error(`Effect "${key}" is already registered.`);
    }
    this.definitions.set(key, definition as EffectDefinition);
    return this;
  }

  resolve(id: string, version: number): EffectDefinition {
    const definition = this.definitions.get(effectKey(id, version));
    if (!definition) {
      throw new Error(`Effect "${effectKey(id, version)}" is not registered.`);
    }
    return definition;
  }

  list(options: { kind?: EffectKind; renderer?: RendererKind } = {}): EffectDefinition[] {
    return [...this.definitions.values()]
      .filter((definition) => options.kind == null || definition.kind === options.kind)
      .filter((definition) => options.renderer == null || definition.capabilities[options.renderer] === true)
      .sort((a, b) => effectKey(a.id, a.version).localeCompare(effectKey(b.id, b.version)));
  }

  resolveForRenderer(
    id: string,
    version: number,
    renderer: RendererKind,
  ): { definition: EffectDefinition; fallbackFrom?: { effectId: string; version: number } } {
    const visited = new Set<string>();
    let definition = this.resolve(id, version);
    const requested = { effectId: id, version };

    while (definition.capabilities[renderer] !== true) {
      const key = effectKey(definition.id, definition.version);
      if (visited.has(key)) {
        throw new Error(`Effect fallback cycle detected at "${key}".`);
      }
      visited.add(key);
      if (!definition.fallback) {
        throw new Error(`Effect "${key}" does not support renderer "${renderer}" and has no fallback.`);
      }
      definition = this.resolve(definition.fallback.effectId, definition.fallback.version);
    }

    return definition.id === id && definition.version === version
      ? { definition }
      : { definition, fallbackFrom: requested };
  }
}

function effectKey(id: string, version: number): string {
  return `${id}@${version}`;
}

function resolveParams<Schema extends EffectParamSchema>(
  schema: Schema,
  values: Partial<InferEffectParams<Schema>>,
): InferEffectParams<Schema> {
  for (const key of Object.keys(values)) {
    if (!(key in schema)) {
      throw new Error(`Unknown effect parameter "${key}".`);
    }
  }

  return Object.fromEntries(
    Object.entries(schema).map(([name, definition]) => {
      const value = values[name as keyof typeof values] ?? definition.default;
      validateParamValue(name, definition, value);
      return [name, value];
    }),
  ) as InferEffectParams<Schema>;
}

function validateParamValue(name: string, definition: EffectParamDefinition, value: unknown): void {
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Effect parameter "${name}" must be a finite number.`);
    }
    if (definition.min != null && value < definition.min) {
      throw new Error(`Effect parameter "${name}" is below its minimum.`);
    }
    if (definition.max != null && value > definition.max) {
      throw new Error(`Effect parameter "${name}" is above its maximum.`);
    }
    return;
  }
  if (definition.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`Effect parameter "${name}" must be a boolean.`);
  }
  if (definition.type === 'enum' && (typeof value !== 'string' || !definition.values.includes(value))) {
    throw new Error(`Effect parameter "${name}" is not an allowed enum value.`);
  }
  if (definition.type === 'vec2') {
    if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      throw new Error(`Effect parameter "${name}" must be a finite vec2.`);
    }
  }
  if (definition.type === 'color' && (typeof value !== 'string' || value.length === 0)) {
    throw new Error(`Effect parameter "${name}" must be a color string.`);
  }
}

export function compileEffect<const Schema extends EffectParamSchema>(options: {
  definition: EffectDefinition<Schema>;
  renderer: RendererKind;
  inputs: Record<string, string | undefined>;
  params: Partial<InferEffectParams<Schema>>;
  progress: number;
  frame: number;
  width: number;
  height: number;
}): CompiledEffect {
  const { definition } = options;
  if (definition.capabilities[options.renderer] !== true) {
    throw new Error(`Effect "${effectKey(definition.id, definition.version)}" does not support renderer "${options.renderer}".`);
  }
  if (!Number.isFinite(options.progress) || options.progress < 0 || options.progress > 1) {
    throw new Error('Effect progress must be between 0 and 1.');
  }
  if (!Number.isInteger(options.frame) || options.frame < 0) {
    throw new Error('Effect frame must be a non-negative integer.');
  }
  if (!Number.isFinite(options.width) || options.width <= 0 || !Number.isFinite(options.height) || options.height <= 0) {
    throw new Error('Effect dimensions must be positive numbers.');
  }

  const resolvedInputs: Record<string, string> = {};
  for (const [name, input] of Object.entries(definition.inputs)) {
    const value = options.inputs[name];
    if (input.required && !value) {
      throw new Error(`Required effect input "${name}" is missing.`);
    }
    if (value) resolvedInputs[name] = value;
  }
  for (const name of Object.keys(options.inputs)) {
    if (!(name in definition.inputs)) {
      throw new Error(`Unknown effect input "${name}".`);
    }
  }

  const params = resolveParams(definition.params, options.params);
  const context: EffectPassContext<Schema> = {
    params,
    progress: options.progress,
    frame: options.frame,
    width: options.width,
    height: options.height,
  };

  return {
    effectId: definition.id,
    effectVersion: definition.version,
    renderer: options.renderer,
    inputs: resolvedInputs,
    params,
    progress: options.progress,
    frame: options.frame,
    width: options.width,
    height: options.height,
    passes: definition.passes.map((pass) => ({
      kind: 'shader',
      shader: pass.shader,
      uniforms: pass.uniforms?.(context) ?? {},
    })),
  };
}

export function computeEffectPresentation<Schema extends EffectParamSchema>(options: {
  definition: EffectDefinition<Schema>;
  params: Partial<InferEffectParams<Schema>>;
  progress: number;
  frame: number;
  width: number;
  height: number;
  role: EffectPresentationRole;
}): EffectPresentationStyle {
  if (!options.definition.presentation) {
    throw new Error(`Effect "${options.definition.id}@${options.definition.version}" has no CSS presentation.`);
  }
  const params = resolveParams(options.definition.params, options.params);
  return options.definition.presentation({
    params,
    progress: Math.min(1, Math.max(0, options.progress)),
    frame: options.frame,
    width: options.width,
    height: options.height,
    role: options.role,
  });
}

export const BUILT_IN_TRANSITION_TYPES = [
  'crossfade',
  'push-left',
  'push-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
  'circle-wipe',
  'zoom-in',
] as const;

export type BuiltInTransitionType = (typeof BUILT_IN_TRANSITION_TYPES)[number];

const CIRCLE_WIPE_FINAL_RADIUS_PERCENT = 150;

function defineCssTransition(
  type: BuiltInTransitionType,
  presentation: NonNullable<EffectDefinition<Record<string, never>>['presentation']>,
): EffectDefinition<Record<string, never>> {
  return defineEffect({
    id: `clash/${type}`,
    version: 1,
    kind: 'transition',
    inputs: {
      from: textureInput(),
      to: textureInput(),
    },
    params: {},
    capabilities: {
      css: true,
      remotion: true,
    },
    passes: [],
    presentation,
  });
}

const builtInTransitions = [
  defineCssTransition('crossfade', ({ progress, role }) => ({
    opacity: role === 'from' ? 1 - progress : progress,
  })),
  defineCssTransition('push-left', ({ progress, role }) => ({
    transform: `translateX(${role === 'from' ? -100 * progress : 100 * (1 - progress)}%)`,
  })),
  defineCssTransition('push-right', ({ progress, role }) => ({
    transform: `translateX(${role === 'from' ? 100 * progress : -100 * (1 - progress)}%)`,
  })),
  defineCssTransition('slide-up', ({ progress, role }) => ({
    transform: `translateY(${role === 'from' ? -100 * progress : 100 * (1 - progress)}%)`,
  })),
  defineCssTransition('slide-down', ({ progress, role }) => ({
    transform: `translateY(${role === 'from' ? 100 * progress : -100 * (1 - progress)}%)`,
  })),
  defineCssTransition('wipe-left', ({ progress, role }) =>
    role === 'from' ? {} : { clipPath: `inset(0 ${100 - 100 * progress}% 0 0)` },
  ),
  defineCssTransition('wipe-right', ({ progress, role }) =>
    role === 'from' ? {} : { clipPath: `inset(0 0 0 ${100 - 100 * progress}%)` },
  ),
  defineCssTransition('circle-wipe', ({ progress, role }) => {
    if (role === 'from') return {};
    // The quadratic curve preserves a restrained midpoint while the 150%
    // endpoint covers the corners of every supported canvas aspect ratio.
    const radius = CIRCLE_WIPE_FINAL_RADIUS_PERCENT * progress ** 2;
    return { clipPath: `circle(${radius}% at 50% 50%)` };
  }),
  defineCssTransition('zoom-in', ({ progress, role }) =>
    role === 'from'
      ? { transform: `scale(${1 + 0.15 * progress})`, opacity: 1 - progress }
      : { transform: `scale(${0.5 + 0.5 * progress})`, opacity: progress },
  ),
];

export const builtInEffectRegistry = new EffectRegistry();
for (const definition of builtInTransitions) {
  builtInEffectRegistry.register(definition);
}

function builtInTransitionEffectId(typeOrId: string): string {
  return typeOrId.includes('/') ? typeOrId : `clash/${typeOrId}`;
}

export function resolveBuiltInTransition(typeOrId: string): EffectDefinition {
  return builtInEffectRegistry.resolve(builtInTransitionEffectId(typeOrId), 1);
}

export function computeBuiltInTransitionStyle(
  typeOrId: string,
  progress: number,
  role: EffectPresentationRole,
  options: { frame?: number; width?: number; height?: number } = {},
): EffectPresentationStyle {
  return computeEffectPresentation({
    definition: resolveBuiltInTransition(typeOrId),
    params: {},
    progress,
    frame: options.frame ?? 0,
    width: options.width ?? 1,
    height: options.height ?? 1,
    role,
  });
}

export const BUILT_IN_CLIP_EFFECTS = [
  'camera-shake',
  'soft-glow',
  'tilt-shift',
  'punch-zoom',
  'slow-drift',
  'warm-film',
  'cool-clean',
  'monochrome',
  'adjust-exposure',
  'adjust-saturation',
  'adjust-contrast',
] as const;

export type BuiltInClipEffect = (typeof BUILT_IN_CLIP_EFFECTS)[number];

const clipInput = { source: textureInput() };

const cameraShakeEffect = defineEffect({
  id: 'clash/camera-shake',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    intensity: numberParam({ default: 5, min: 0, max: 16, step: 0.5, keyframable: true }),
    speed: numberParam({ default: 1, min: 0.25, max: 4, step: 0.25, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params, frame }) => {
    const phase = frame * 0.71 * params.speed;
    const x = Math.sin(phase * 1.7) * params.intensity;
    const y = Math.sin(phase * 2.3 + 1.4) * params.intensity * 0.62;
    const rotation = Math.sin(phase * 1.1 + 0.8) * params.intensity * 0.045;
    return { transform: `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) rotate(${rotation.toFixed(3)}deg)` };
  },
});

const softGlowEffect = defineEffect({
  id: 'clash/soft-glow',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    intensity: numberParam({ default: 0.35, min: 0, max: 1, step: 0.05, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({
    filter: `brightness(${1 + params.intensity * 0.18}) saturate(${1 + params.intensity * 0.32}) contrast(${1 - params.intensity * 0.08})`,
  }),
});

const tiltShiftEffect = defineEffect({
  id: 'clash/tilt-shift',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    blur: numberParam({ default: 1.4, min: 0, max: 5, step: 0.1, keyframable: true }),
    saturation: numberParam({ default: 1.14, min: 0.5, max: 1.8, step: 0.05, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({ filter: `blur(${params.blur}px) saturate(${params.saturation})` }),
});

const punchZoomEffect = defineEffect({
  id: 'clash/punch-zoom',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    amount: numberParam({ default: 0.14, min: 0, max: 0.4, step: 0.01, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params, progress }) => {
    const pulse = Math.sin(Math.min(1, progress * 3.2) * Math.PI);
    return { transform: `scale(${(1 + params.amount * pulse).toFixed(4)})` };
  },
});

const slowDriftEffect = defineEffect({
  id: 'clash/slow-drift',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    amount: numberParam({ default: 0.08, min: 0, max: 0.25, step: 0.01, keyframable: true }),
    direction: numberParam({ default: 1, min: -1, max: 1, step: 2, keyframable: false }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params, progress }) => ({
    transform: `translateX(${((progress - 0.5) * params.amount * 100 * params.direction).toFixed(3)}%) scale(${(1 + params.amount).toFixed(4)})`,
  }),
});

const warmFilmEffect = defineEffect({
  id: 'clash/warm-film',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    intensity: numberParam({ default: 0.55, min: 0, max: 1, step: 0.05, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({
    filter: `sepia(${(params.intensity * 0.28).toFixed(3)}) saturate(${(1 + params.intensity * 0.24).toFixed(3)}) contrast(${(1 + params.intensity * 0.06).toFixed(3)})`,
  }),
});

const coolCleanEffect = defineEffect({
  id: 'clash/cool-clean',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    intensity: numberParam({ default: 0.5, min: 0, max: 1, step: 0.05, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({
    filter: `hue-rotate(${(-8 * params.intensity).toFixed(2)}deg) saturate(${(1 - params.intensity * 0.08).toFixed(3)}) contrast(${(1 + params.intensity * 0.08).toFixed(3)})`,
  }),
});

const monochromeEffect = defineEffect({
  id: 'clash/monochrome',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    intensity: numberParam({ default: 1, min: 0, max: 1, step: 0.05, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({ filter: `grayscale(${params.intensity}) contrast(1.08)` }),
});

const exposureEffect = defineEffect({
  id: 'clash/adjust-exposure',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    amount: numberParam({ default: 0.12, min: -0.65, max: 0.65, step: 0.01, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({ filter: `brightness(${Math.max(0.1, 1 + params.amount).toFixed(3)})` }),
});

const saturationEffect = defineEffect({
  id: 'clash/adjust-saturation',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    amount: numberParam({ default: 0.18, min: -1, max: 1, step: 0.01, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({ filter: `saturate(${Math.max(0, 1 + params.amount).toFixed(3)})` }),
});

const contrastEffect = defineEffect({
  id: 'clash/adjust-contrast',
  version: 1,
  kind: 'clip-effect',
  inputs: clipInput,
  params: {
    amount: numberParam({ default: 0.1, min: -0.8, max: 0.8, step: 0.01, keyframable: true }),
  },
  capabilities: { css: true, remotion: true },
  passes: [],
  presentation: ({ params }) => ({ filter: `contrast(${Math.max(0.1, 1 + params.amount).toFixed(3)})` }),
});

const builtInClipEffectDefinitions: EffectDefinition[] = [
  cameraShakeEffect,
  softGlowEffect,
  tiltShiftEffect,
  punchZoomEffect,
  slowDriftEffect,
  warmFilmEffect,
  coolCleanEffect,
  monochromeEffect,
  exposureEffect,
  saturationEffect,
  contrastEffect,
].map((definition) => definition as EffectDefinition);

for (const definition of builtInClipEffectDefinitions) {
  builtInEffectRegistry.register(definition);
}

export const BUILT_IN_SHADER_EFFECTS = [
  'displacement-warp',
  'prism-split',
  'pixel-dissolve',
] as const;

export type BuiltInShaderEffect = (typeof BUILT_IN_SHADER_EFFECTS)[number];

export const CINEMATIC_SHADER_EFFECTS = [
  'whip-pan',
  'light-leak',
  'flash-through-white',
] as const;

export type CinematicShaderEffect = (typeof CINEMATIC_SHADER_EFFECTS)[number];

const hyperframesProvenance = (upstreamId: CinematicShaderEffect): EffectProvenance => ({
  provider: 'hyperframes',
  upstreamId,
  sourceUrl: 'https://github.com/heygen-com/hyperframes/tree/main/packages/shader-transitions',
  license: 'Apache-2.0',
  adapted: true,
});

const displacementWarpEffect = defineEffect({
  id: 'clash/displacement-warp',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.45, min: 0, max: 1, keyframable: true }),
    frequency: numberParam({ default: 6, min: 1, max: 16, keyframable: true }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  passes: [
    {
      kind: 'shader',
      shader: 'transition-displacement-warp',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_frequency: params.frequency,
      }),
    },
  ],
});

const prismSplitEffect = defineEffect({
  id: 'clash/prism-split',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.65, min: 0, max: 1, keyframable: true }),
    angle: numberParam({ default: 0, min: -3.14159, max: 3.14159, keyframable: true }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  passes: [
    {
      kind: 'shader',
      shader: 'transition-prism-split',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_angle: params.angle,
      }),
    },
  ],
});

const pixelDissolveEffect = defineEffect({
  id: 'clash/pixel-dissolve',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.7, min: 0, max: 1, keyframable: true }),
    cellSize: numberParam({ default: 30, min: 4, max: 120, keyframable: true }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  passes: [
    {
      kind: 'shader',
      shader: 'transition-pixel-dissolve',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_cell_size: params.cellSize,
      }),
    },
  ],
});

const whipPanEffect = defineEffect({
  id: 'clash/whip-pan',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.055, min: 0, max: 0.12, step: 0.005, keyframable: true }),
    direction: numberParam({ default: -1, min: -1, max: 1, step: 2, keyframable: false }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  provenance: hyperframesProvenance('whip-pan'),
  passes: [
    {
      kind: 'shader',
      shader: 'transition-whip-pan',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_direction: params.direction,
      }),
    },
  ],
});

const lightLeakEffect = defineEffect({
  id: 'clash/light-leak',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.72, min: 0, max: 1.2, step: 0.05, keyframable: true }),
    warmth: numberParam({ default: 0.82, min: 0, max: 1, step: 0.05, keyframable: true }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  provenance: hyperframesProvenance('light-leak'),
  passes: [
    {
      kind: 'shader',
      shader: 'transition-light-leak',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_warmth: params.warmth,
      }),
    },
  ],
});

const flashThroughWhiteEffect = defineEffect({
  id: 'clash/flash-through-white',
  version: 1,
  kind: 'transition',
  inputs: { from: textureInput(), to: textureInput() },
  params: {
    intensity: numberParam({ default: 0.9, min: 0, max: 1, step: 0.05, keyframable: true }),
    softness: numberParam({ default: 0.18, min: 0.05, max: 0.35, step: 0.01, keyframable: true }),
  },
  capabilities: { webgl2: true },
  fallback: { effectId: 'clash/crossfade', version: 1 },
  provenance: hyperframesProvenance('flash-through-white'),
  passes: [
    {
      kind: 'shader',
      shader: 'transition-flash-through-white',
      uniforms: ({ params, progress }) => ({
        u_progress: progress,
        u_intensity: params.intensity,
        u_softness: params.softness,
      }),
    },
  ],
});

builtInEffectRegistry.register(displacementWarpEffect);
builtInEffectRegistry.register(prismSplitEffect);
builtInEffectRegistry.register(pixelDissolveEffect);
builtInEffectRegistry.register(whipPanEffect);
builtInEffectRegistry.register(lightLeakEffect);
builtInEffectRegistry.register(flashThroughWhiteEffect);

export function resolveBuiltInShaderEffect(nameOrId: string): EffectDefinition {
  const id = nameOrId.includes('/') ? nameOrId : `clash/${nameOrId}`;
  return builtInEffectRegistry.resolve(id, 1);
}
