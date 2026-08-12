import { describe, expect, it } from 'vitest';

import { assetReachForRuntime, ExecutablePluginManifestSchema, pluginRuntimeProfile } from './executable-plugin.js';

/**
 * Run mode already states what a plugin can reach, so nothing else declares it.
 *
 * `runtime.kind` is mandatory and discriminates the union: `local` means the host spawns the
 * plugin over stdio on this machine, `hosted` means it is invoked over HTTP somewhere else. That
 * single fact settles the asset question:
 *
 *   local   the plugin shares a network namespace with the host, so a loopback URL works
 *   hosted  the plugin is elsewhere, so a loopback URL resolves to something unrelated
 *
 * A second field naming the accepted forms would repeat this and could contradict it -- the same
 * duplication as bindings that restated their provider's route, or a manifest restating the OAuth
 * its provider already implies.
 *
 * What run mode constrains is *reach*, not form. Bytes work for both (a hosted plugin pays to
 * receive them, but they arrive); a private URL is simply broken for a hosted plugin, and no
 * amount of preference ordering fixes that.
 */
describe('asset reach follows run mode', () => {
  it('lets a local plugin use a host-private URL', () => {
    expect(assetReachForRuntime('local')).toEqual(['public', 'private']);
  });

  it('restricts a hosted plugin to publicly fetchable URLs', () => {
    expect(assetReachForRuntime('hosted')).toEqual(['public']);
  });

  it('needs no separate declaration in the manifest', () => {
    const manifest = ExecutablePluginManifestSchema.parse({
      apiVersion: 'clash.plugin/v1',
      id: 'acme.demo-plugin',
      version: '1.0.0',
      name: 'Demo',
      runtime: { kind: 'local', transport: 'stdio', language: 'node', entrypoint: 'dist/stdio.mjs' },
      contributes: { cards: [], providers: [], modelBindings: [], functions: [] },
    });
    expect('assetForms' in manifest).toBe(false);
    expect(assetReachForRuntime(manifest.runtime.kind)).toContain('private');
  });
});

describe('run mode is stated once', () => {
  it('exposes the difference as a profile the host reads', () => {
    // Anything that differs between a plugin spawned here and one called over HTTP belongs to run
    // mode, not to a second manifest field. Today reach is the only such difference with a
    // consumer; the remaining `runtime.kind` branches choose between `entrypoint` and `endpoint`,
    // which is structure rather than capability.
    expect(pluginRuntimeProfile('local').assetReach).toContain('private');
    expect(pluginRuntimeProfile('hosted').assetReach).not.toContain('private');
    expect(assetReachForRuntime('hosted')).toEqual(pluginRuntimeProfile('hosted').assetReach);
  });
});
