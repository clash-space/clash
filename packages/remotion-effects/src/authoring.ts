import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { EffectKind, EffectInputDefinition, EffectParamDefinition, RendererKind } from './index';

export type EffectPackageIssue = {
  code: string;
  message: string;
  path?: string;
};

export type EffectPackageManifest = {
  schemaVersion: 1;
  id: string;
  version: number;
  kind: EffectKind;
  inputs: Record<string, EffectInputDefinition>;
  params: Record<string, EffectParamDefinition>;
  capabilities: Partial<Record<RendererKind, boolean>>;
  fallback?: { effectId: string; version: number };
  passes: Array<{
    kind: 'shader';
    shader: string;
    fragment: string;
  }>;
};

export type EffectPackageValidation = {
  ok: boolean;
  effect?: EffectPackageManifest;
  files: string[];
  issues: EffectPackageIssue[];
};

export type PackedEffectBundle = {
  schemaVersion: 1;
  effect: EffectPackageManifest;
  files: Array<{
    path: string;
    sha256: string;
    contentBase64: string;
  }>;
};

export async function validateEffectPackage(root: string): Promise<EffectPackageValidation> {
  const issues: EffectPackageIssue[] = [];
  const files = ['effect.json'];
  let rawManifest: string;

  try {
    rawManifest = await readFile(join(root, 'effect.json'), 'utf8');
  } catch {
    return {
      ok: false,
      files: [],
      issues: [{ code: 'package.manifest_missing', message: 'effect.json is required.', path: 'effect.json' }],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(rawManifest);
  } catch {
    return {
      ok: false,
      files,
      issues: [{ code: 'package.manifest_invalid_json', message: 'effect.json must contain valid JSON.', path: 'effect.json' }],
    };
  }

  const effect = validateManifest(value, issues);
  if (!effect) return { ok: false, files, issues };

  for (const pass of effect.passes) {
    const fragment = pass.fragment;
    if (!isSafeRelativePath(fragment)) {
      issues.push({
        code: 'package.path_unsafe',
        message: `Shader path "${fragment}" must stay inside the effect package.`,
        path: fragment,
      });
      continue;
    }

    const absolutePath = join(root, fragment);
    const relativePath = relative(root, absolutePath);
    if (relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      issues.push({
        code: 'package.path_unsafe',
        message: `Shader path "${fragment}" must stay inside the effect package.`,
        path: fragment,
      });
      continue;
    }

    try {
      const source = await readFile(absolutePath, 'utf8');
      files.push(normalize(fragment).split(sep).join('/'));
      if (!source.trim()) {
        issues.push({ code: 'package.shader_empty', message: 'Shader source cannot be empty.', path: fragment });
      }
      if (!/\bvoid\s+main\s*\(/.test(source) && !/@fragment\b/.test(source)) {
        issues.push({
          code: 'package.shader_entry_missing',
          message: 'Shader source must define a GLSL main function or WGSL fragment entry point.',
          path: fragment,
        });
      }
    } catch {
      issues.push({
        code: 'package.file_missing',
        message: `Referenced shader file "${fragment}" does not exist.`,
        path: fragment,
      });
    }
  }

  return {
    ok: issues.length === 0,
    effect,
    files: [...new Set(files)].sort((a, b) => a.localeCompare(b)),
    issues,
  };
}

function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path)) return false;
  const normalized = normalize(path);
  return normalized !== '..' && !normalized.startsWith(`..${sep}`);
}

function validateManifest(value: unknown, issues: EffectPackageIssue[]): EffectPackageManifest | undefined {
  if (!isRecord(value)) {
    issues.push({ code: 'manifest.type', message: 'Effect manifest must be an object.', path: 'effect.json' });
    return undefined;
  }

  if (value.schemaVersion !== 1) {
    issues.push({ code: 'manifest.schema_version', message: 'schemaVersion must be 1.', path: 'schemaVersion' });
  }
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value.id)) {
    issues.push({ code: 'manifest.id', message: 'id must be a namespaced lower-case identifier.', path: 'id' });
  }
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    issues.push({ code: 'manifest.version', message: 'version must be a positive integer.', path: 'version' });
  }
  const kinds: EffectKind[] = ['clip-effect', 'transition', 'generator', 'mask', 'composite'];
  if (typeof value.kind !== 'string' || !kinds.includes(value.kind as EffectKind)) {
    issues.push({ code: 'manifest.kind', message: 'kind is not supported.', path: 'kind' });
  }
  if (!isRecord(value.inputs)) {
    issues.push({ code: 'manifest.inputs', message: 'inputs must be an object.', path: 'inputs' });
  } else {
    for (const [name, input] of Object.entries(value.inputs)) {
      if (!isRecord(input) || !['texture', 'video', 'image', 'mask'].includes(String(input.type)) || typeof input.required !== 'boolean') {
        issues.push({
          code: 'manifest.input',
          message: 'Each input must declare a supported type and boolean required flag.',
          path: `inputs.${name}`,
        });
      }
    }
  }
  if (!isRecord(value.params)) {
    issues.push({ code: 'manifest.params', message: 'params must be an object.', path: 'params' });
  } else {
    for (const [name, param] of Object.entries(value.params)) {
      if (!isValidManifestParam(param)) {
        issues.push({
          code: 'manifest.param',
          message: 'Parameter definition has an invalid type, default, or range.',
          path: `params.${name}`,
        });
      }
    }
  }
  if (!isRecord(value.capabilities)) {
    issues.push({ code: 'manifest.capabilities', message: 'capabilities must be an object.', path: 'capabilities' });
  } else {
    const renderers: RendererKind[] = ['css', 'webgl2', 'webgpu', 'remotion', 'ffmpeg'];
    for (const [renderer, enabled] of Object.entries(value.capabilities)) {
      if (!renderers.includes(renderer as RendererKind) || typeof enabled !== 'boolean') {
        issues.push({
          code: 'manifest.capability',
          message: 'Capability keys must name a supported renderer and contain a boolean.',
          path: `capabilities.${renderer}`,
        });
      }
    }
  }
  if (value.fallback != null) {
    const fallback = value.fallback;
    if (
      !isRecord(fallback) ||
      typeof fallback.effectId !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(fallback.effectId) ||
      !Number.isInteger(fallback.version) ||
      (fallback.version as number) < 1
    ) {
      issues.push({
        code: 'manifest.fallback',
        message: 'fallback must contain a namespaced effectId and positive integer version.',
        path: 'fallback',
      });
    }
  }
  if (!Array.isArray(value.passes)) {
    issues.push({ code: 'manifest.passes', message: 'passes must be an array.', path: 'passes' });
  } else {
    value.passes.forEach((pass, index) => {
      if (!isRecord(pass) || pass.kind !== 'shader' || typeof pass.shader !== 'string' || typeof pass.fragment !== 'string') {
        issues.push({
          code: 'manifest.pass',
          message: 'Each pass must declare kind, shader, and fragment.',
          path: `passes.${index}`,
        });
      }
    });
  }

  if (issues.length > 0) return undefined;
  return value as EffectPackageManifest;
}

function isValidManifestParam(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.keyframable != null && typeof value.keyframable !== 'boolean') return false;
  if (value.type === 'number') {
    if (typeof value.default !== 'number' || !Number.isFinite(value.default)) return false;
    if (value.min != null && (typeof value.min !== 'number' || !Number.isFinite(value.min))) return false;
    if (value.max != null && (typeof value.max !== 'number' || !Number.isFinite(value.max))) return false;
    if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max) return false;
    if (typeof value.min === 'number' && value.default < value.min) return false;
    if (typeof value.max === 'number' && value.default > value.max) return false;
    return true;
  }
  if (value.type === 'boolean') return typeof value.default === 'boolean';
  if (value.type === 'color') return typeof value.default === 'string' && value.default.length > 0;
  if (value.type === 'enum') {
    return (
      typeof value.default === 'string' &&
      Array.isArray(value.values) &&
      value.values.length > 0 &&
      value.values.every((entry) => typeof entry === 'string') &&
      value.values.includes(value.default)
    );
  }
  if (value.type === 'vec2') {
    return (
      Array.isArray(value.default) &&
      value.default.length === 2 &&
      value.default.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function scaffoldEffectPackage(options: {
  target: string;
  id: string;
  kind: EffectKind;
}): Promise<{ target: string; files: string[] }> {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(options.id)) {
    throw new Error('Effect id must be a namespaced lower-case identifier such as agent/liquid-wipe.');
  }
  await mkdir(options.target, { recursive: false });
  await mkdir(join(options.target, 'shaders'));

  const inputs = scaffoldInputs(options.kind);
  const manifest: EffectPackageManifest = {
    schemaVersion: 1,
    id: options.id,
    version: 1,
    kind: options.kind,
    inputs,
    params: {
      intensity: {
        type: 'number',
        default: 0.5,
        min: 0,
        max: 1,
        keyframable: true,
      },
    },
    capabilities: {
      webgl2: true,
      remotion: true,
    },
    passes: [
      {
        kind: 'shader',
        shader: options.id.replace('/', '-'),
        fragment: 'shaders/main.glsl',
      },
    ],
  };

  const files = ['README.md', 'effect.json', 'shaders/main.glsl'];
  await writeFile(join(options.target, 'effect.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(join(options.target, 'shaders/main.glsl'), scaffoldShader(options.kind), 'utf8');
  await writeFile(join(options.target, 'README.md'), scaffoldReadme(options.id, options.kind), 'utf8');

  return { target: options.target, files };
}

function scaffoldInputs(kind: EffectKind): Record<string, EffectInputDefinition> {
  if (kind === 'generator') return {};
  if (kind === 'transition' || kind === 'composite') {
    return {
      from: { type: 'texture', required: true },
      to: { type: 'texture', required: true },
    };
  }
  return { source: { type: 'texture', required: true } };
}

function scaffoldShader(kind: EffectKind): string {
  if (kind === 'generator') {
    return `precision highp float;
uniform vec2 u_resolution;
uniform float u_intensity;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(uv, u_intensity, 1.0);
}
`;
  }
  if (kind === 'transition' || kind === 'composite') {
    return `precision highp float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
varying vec2 v_uv;

void main() {
  gl_FragColor = mix(texture2D(u_from, v_uv), texture2D(u_to, v_uv), u_progress);
}
`;
  }
  return `precision highp float;
uniform sampler2D u_source;
uniform float u_intensity;
varying vec2 v_uv;

void main() {
  vec4 source = texture2D(u_source, v_uv);
  gl_FragColor = mix(source, vec4(source.rgb, 1.0), u_intensity);
}
`;
}

function scaffoldReadme(id: string, kind: EffectKind): string {
  return `# ${id}

Clash ${kind} effect package.

## Agent workflow

1. Edit \`effect.json\` to declare inputs, parameters, capabilities, and render passes.
2. Implement shaders under \`shaders/\`; keep all referenced files inside this directory.
3. Run \`clash effect validate .\` after every semantic change.
4. Run \`clash effect pack .\` only after validation passes.

Timeline state stores only the effect id, version, inputs, and parameter values. Never place executable shader source directly in a Timeline document.
`;
}

export async function packEffectPackage(options: {
  root: string;
  output?: string;
}): Promise<{ output: string; bundle: PackedEffectBundle }> {
  const validation = await validateEffectPackage(options.root);
  if (!validation.ok || !validation.effect) {
    const summary = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n');
    throw new Error(`Effect package validation failed.\n${summary}`);
  }

  const files = await Promise.all(
    validation.files.map(async (path) => {
      const content = await readFile(join(options.root, path));
      return {
        path,
        sha256: sha256(content),
        contentBase64: content.toString('base64'),
      };
    }),
  );
  const bundle: PackedEffectBundle = {
    schemaVersion: 1,
    effect: validation.effect,
    files,
  };
  const output = options.output ?? join(
    options.root,
    `${validation.effect.id.replace('/', '-')}-${validation.effect.version}.clash-effect.json`,
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return { output, bundle };
}

export async function installEffectPackage(options: {
  bundle: string;
  effectsRoot: string;
}): Promise<{ installPath: string; effect: EffectPackageManifest }> {
  const bundleValue = JSON.parse(await readFile(options.bundle, 'utf8')) as unknown;
  const parsed = parseBundle(bundleValue);
  const [namespace, name] = parsed.effect.id.split('/');
  const installPath = join(options.effectsRoot, namespace, name, String(parsed.effect.version));

  await mkdir(dirname(installPath), { recursive: true });
  try {
    await mkdir(installPath, { recursive: false });
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') {
      throw new Error(`Effect "${parsed.effect.id}@${parsed.effect.version}" is already installed.`);
    }
    throw error;
  }

  for (const file of parsed.files) {
    const output = join(installPath, file.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, Buffer.from(file.contentBase64, 'base64'));
  }

  return { installPath, effect: parsed.effect };
}

function parseBundle(value: unknown): PackedEffectBundle {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.files)) {
    throw new Error('Effect bundle is invalid or uses an unsupported schema version.');
  }
  const issues: EffectPackageIssue[] = [];
  const effect = validateManifest(value.effect, issues);
  if (!effect || issues.length > 0) {
    throw new Error(`Effect bundle manifest is invalid: ${issues.map((issue) => issue.message).join(' ')}`);
  }

  const files = value.files.map((file, index) => {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.sha256 !== 'string' || typeof file.contentBase64 !== 'string') {
      throw new Error(`Effect bundle file at index ${index} is invalid.`);
    }
    if (!isSafeRelativePath(file.path)) {
      throw new Error(`Effect bundle file path "${file.path}" is unsafe.`);
    }
    const content = Buffer.from(file.contentBase64, 'base64');
    if (sha256(content) !== file.sha256) {
      throw new Error(`Effect bundle checksum mismatch for "${file.path}".`);
    }
    return { path: file.path, sha256: file.sha256, contentBase64: file.contentBase64 };
  });

  const manifestFile = files.find((file) => file.path === 'effect.json');
  if (!manifestFile) throw new Error('Effect bundle does not contain effect.json.');
  const bundledManifest = JSON.parse(Buffer.from(manifestFile.contentBase64, 'base64').toString('utf8')) as unknown;
  if (JSON.stringify(bundledManifest) !== JSON.stringify(effect)) {
    throw new Error('Effect bundle manifest does not match its effect.json file.');
  }

  return { schemaVersion: 1, effect, files };
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
