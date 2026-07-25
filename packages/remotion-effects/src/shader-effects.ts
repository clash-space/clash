export {
  BUILT_IN_SHADER_EFFECTS,
  CINEMATIC_SHADER_EFFECTS,
  resolveBuiltInShaderEffect,
  type BuiltInShaderEffect,
  type CinematicShaderEffect,
} from './index';

const SHADER_SOURCES: Record<string, string> = {
  'transition-displacement-warp': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_intensity;
uniform float u_frequency;
out vec4 out_color;

float wave(vec2 uv, float phase) {
  return sin((uv.y * u_frequency + phase) * 6.2831853) * 0.5 +
    sin((uv.x * (u_frequency * 0.63) - phase * 1.7) * 6.2831853) * 0.5;
}

void main() {
  float envelope = sin(u_progress * 3.1415926);
  float displacement = wave(v_uv, u_progress) * u_intensity * 0.075 * envelope;
  vec2 from_uv = clamp(v_uv + vec2(displacement, displacement * 0.28), 0.0, 1.0);
  vec2 to_uv = clamp(v_uv - vec2(displacement, displacement * 0.28), 0.0, 1.0);
  vec4 from_color = texture(u_from, from_uv);
  vec4 to_color = texture(u_to, to_uv);
  float blend = smoothstep(0.08, 0.92, u_progress + wave(v_uv, 0.0) * 0.08 * envelope);
  out_color = mix(from_color, to_color, blend);
}
`,
  'transition-prism-split': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_intensity;
uniform float u_angle;
out vec4 out_color;

void main() {
  float envelope = sin(u_progress * 3.1415926);
  vec2 direction = vec2(cos(u_angle), sin(u_angle));
  vec2 offset = direction * envelope * u_intensity * 0.035;
  vec4 a = texture(u_from, v_uv);
  vec4 b = texture(u_to, v_uv);
  vec4 from_split = vec4(
    texture(u_from, clamp(v_uv + offset, 0.0, 1.0)).r,
    a.g,
    texture(u_from, clamp(v_uv - offset, 0.0, 1.0)).b,
    1.0
  );
  vec4 to_split = vec4(
    texture(u_to, clamp(v_uv - offset, 0.0, 1.0)).r,
    b.g,
    texture(u_to, clamp(v_uv + offset, 0.0, 1.0)).b,
    1.0
  );
  out_color = mix(from_split, to_split, smoothstep(0.0, 1.0, u_progress));
}
`,
  'transition-pixel-dissolve': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform vec2 u_resolution;
uniform float u_progress;
uniform float u_intensity;
uniform float u_cell_size;
out vec4 out_color;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 cells = floor(v_uv * u_resolution / max(2.0, u_cell_size));
  float threshold = hash21(cells);
  float softness = mix(0.015, 0.12, u_intensity);
  float reveal = smoothstep(threshold - softness, threshold + softness, u_progress);
  vec2 center = (cells + 0.5) * max(2.0, u_cell_size) / u_resolution;
  vec2 pixel_uv = mix(v_uv, center, sin(u_progress * 3.1415926) * u_intensity * 0.6);
  out_color = mix(texture(u_from, pixel_uv), texture(u_to, pixel_uv), reveal);
}
`,
  'transition-whip-pan': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_intensity;
uniform float u_direction;
out vec4 out_color;

vec3 directionalBlur(sampler2D source, vec2 uv, float span) {
  vec3 color = vec3(0.0);
  for (int index = 0; index < 12; index += 1) {
    float sample_position = (float(index) / 11.0) - 0.5;
    vec2 sample_uv = clamp(uv + vec2(sample_position * span, 0.0), 0.0, 1.0);
    color += texture(source, sample_uv).rgb;
  }
  return color / 12.0;
}

void main() {
  float progress = smoothstep(0.0, 1.0, u_progress);
  float envelope = sin(progress * 3.1415926);
  float direction = u_direction < 0.0 ? -1.0 : 1.0;
  float travel = 1.08;
  vec2 from_uv = v_uv + vec2(direction * progress * travel, 0.0);
  vec2 to_uv = v_uv - vec2(direction * (1.0 - progress) * travel, 0.0);
  float blur_span = envelope * u_intensity;
  vec3 from_color = directionalBlur(u_from, from_uv, blur_span * direction);
  vec3 to_color = directionalBlur(u_to, to_uv, blur_span * direction);
  out_color = vec4(mix(from_color, to_color, progress), 1.0);
}
`,
  'transition-light-leak': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_intensity;
uniform float u_warmth;
out vec4 out_color;

vec3 acesToneMap(vec3 color) {
  return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  float progress = smoothstep(0.0, 1.0, u_progress);
  vec3 from_color = texture(u_from, v_uv).rgb;
  vec3 to_color = texture(u_to, v_uv).rgb;
  float envelope = sin(progress * 3.1415926);
  vec2 leak_origin = vec2(1.12, -0.12);
  float distance_to_leak = length(v_uv - leak_origin);
  float leak = exp(-distance_to_leak * 2.35) * envelope * u_intensity;
  float streak = exp(-abs(v_uv.y - (-0.05 + v_uv.x * 0.28)) * 18.0) * leak * 0.22;
  vec3 amber = mix(vec3(1.0, 0.69, 0.37), vec3(1.0, 0.88, 0.68), u_warmth);
  vec3 base = mix(from_color, to_color, progress);
  vec3 exposed = base + amber * leak * 1.8 + vec3(1.0, 0.82, 0.62) * streak;
  out_color = vec4(mix(base, acesToneMap(exposed), clamp(leak + streak, 0.0, 1.0)), 1.0);
}
`,
  'transition-flash-through-white': `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_intensity;
uniform float u_softness;
out vec4 out_color;

void main() {
  float progress = clamp(u_progress, 0.0, 1.0);
  vec3 from_color = texture(u_from, v_uv).rgb;
  vec3 to_color = texture(u_to, v_uv).rgb;
  float blend = smoothstep(0.5 - u_softness, 0.5 + u_softness, progress);
  float flash = pow(sin(progress * 3.1415926), 1.6) * u_intensity;
  vec3 scene = mix(from_color, to_color, blend);
  out_color = vec4(mix(scene, vec3(1.0), flash), 1.0);
}
`,
};

export function getBuiltInShaderSource(shader: string): string {
  const source = SHADER_SOURCES[shader];
  if (!source) throw new Error(`Built-in shader "${shader}" is not registered.`);
  return source;
}
