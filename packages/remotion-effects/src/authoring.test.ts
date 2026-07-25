import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installEffectPackage,
  packEffectPackage,
  scaffoldEffectPackage,
  validateEffectPackage,
} from './authoring';

describe('validateEffectPackage', () => {
  it('validates an agent-authored manifest and referenced shader files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clash-effect-'));
    await mkdir(join(root, 'shaders'));
    await writeFile(
      join(root, 'effect.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent/liquid-wipe',
        version: 1,
        kind: 'transition',
        inputs: {
          from: { type: 'texture', required: true },
          to: { type: 'texture', required: true },
        },
        params: {
          strength: { type: 'number', default: 0.4, min: 0, max: 1 },
        },
        capabilities: { webgl2: true, remotion: true },
        passes: [{ kind: 'shader', shader: 'liquid-wipe', fragment: 'shaders/liquid-wipe.glsl' }],
      }),
    );
    await writeFile(
      join(root, 'shaders/liquid-wipe.glsl'),
      'precision highp float;\nvoid main() { gl_FragColor = vec4(1.0); }\n',
    );

    const result = await validateEffectPackage(root);

    expect(result.ok).toBe(true);
    expect(result.effect).toMatchObject({ id: 'agent/liquid-wipe', version: 1 });
    expect(result.files).toEqual(['effect.json', 'shaders/liquid-wipe.glsl']);
  });

  it('reports missing shader files without executing package code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clash-effect-'));
    await writeFile(
      join(root, 'effect.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent/broken',
        version: 1,
        kind: 'transition',
        inputs: {},
        params: {},
        capabilities: { webgl2: true },
        passes: [{ kind: 'shader', shader: 'broken', fragment: 'shaders/missing.glsl' }],
      }),
    );

    const result = await validateEffectPackage(root);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'package.file_missing', path: 'shaders/missing.glsl' }),
    );
  });

  it('rejects malformed input, parameter, capability, and fallback contracts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clash-effect-'));
    await writeFile(
      join(root, 'effect.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent/unsafe-contract',
        version: 1,
        kind: 'transition',
        inputs: { from: { type: 'socket', required: 'yes' } },
        params: { strength: { type: 'number', default: 2, min: 0, max: 1 } },
        capabilities: { webgl2: 'sometimes' },
        fallback: { effectId: 'crossfade', version: 0 },
        passes: [],
      }),
    );

    const result = await validateEffectPackage(root);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'manifest.input',
        'manifest.param',
        'manifest.capability',
        'manifest.fallback',
      ]),
    );
  });
});

describe('agent authoring workflow', () => {
  it('scaffolds a package that validates without executing authored code', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'clash-effect-workspace-'));
    const target = join(workspace, 'liquid-wipe');

    const created = await scaffoldEffectPackage({
      target,
      id: 'agent/liquid-wipe',
      kind: 'transition',
    });

    expect(created.files).toEqual(['README.md', 'effect.json', 'shaders/main.glsl']);
    expect((await validateEffectPackage(target)).ok).toBe(true);
  });

  it('packs deterministically and installs an immutable versioned package', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'clash-effect-workspace-'));
    const target = join(workspace, 'liquid-wipe');
    await scaffoldEffectPackage({ target, id: 'agent/liquid-wipe', kind: 'transition' });

    const first = await packEffectPackage({ root: target, output: join(workspace, 'first.clash-effect.json') });
    const second = await packEffectPackage({ root: target, output: join(workspace, 'second.clash-effect.json') });

    expect(await readFile(first.output, 'utf8')).toBe(await readFile(second.output, 'utf8'));

    const effectsRoot = join(workspace, 'installed');
    const installed = await installEffectPackage({ bundle: first.output, effectsRoot });
    expect(installed.installPath).toBe(join(effectsRoot, 'agent', 'liquid-wipe', '1'));
    expect(JSON.parse(await readFile(join(installed.installPath, 'effect.json'), 'utf8'))).toMatchObject({
      id: 'agent/liquid-wipe',
      version: 1,
    });
    await expect(installEffectPackage({ bundle: first.output, effectsRoot })).rejects.toThrow(/already installed/i);
  });
});
