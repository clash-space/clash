import { describe, expect, it } from 'vitest';
import {
  detectNleAvailability,
  isNleApplicationBundle,
  materializedAssetPath,
  nleApplicationName,
  replaceAssetTokens,
  safeHandoffName,
} from './nle-handoff';

describe('desktop NLE handoff', () => {
  it('maps each target to the intended desktop application', () => {
    expect(nleApplicationName('premiere-pro')).toBe('Adobe Premiere Pro');
    expect(nleApplicationName('final-cut-pro')).toBe('Final Cut Pro');
    expect(nleApplicationName('davinci-resolve')).toBe('DaVinci Resolve');
  });

  it('recognizes versioned Premiere bundles without confusing unrelated apps', () => {
    expect(isNleApplicationBundle('premiere-pro', 'Adobe Premiere Pro 2026.app')).toBe(true);
    expect(isNleApplicationBundle('premiere-pro', 'Adobe Premiere Rush.app')).toBe(false);
    expect(isNleApplicationBundle('final-cut-pro', 'Final Cut Pro.app')).toBe(true);
    expect(isNleApplicationBundle('davinci-resolve', 'DaVinci Resolve.app')).toBe(true);
  });

  it('reports real installed state from a read-only application probe', async () => {
    const availability = await detectNleAvailability(async (target) =>
      target === 'final-cut-pro' ? '/Applications/Final Cut Pro.app' : null,
    );

    expect(availability).toEqual([
      { target: 'premiere-pro', applicationName: 'Adobe Premiere Pro', installed: false },
      {
        target: 'final-cut-pro',
        applicationName: 'Final Cut Pro',
        installed: true,
        applicationPath: '/Applications/Final Cut Pro.app',
      },
      { target: 'davinci-resolve', applicationName: 'DaVinci Resolve', installed: false },
    ]);
  });

  it('creates stable safe export names', () => {
    expect(safeHandoffName('  Launch / Cut  ', 'rev:7')).toBe('Launch-Cut-rev-7');
  });

  it('keeps local assets in place and materializes remote assets beside the handoff', () => {
    expect(materializedAssetPath('/tmp/handoff/media', '/Users/me/clip.mov', 'clip.mov')).toBe('/Users/me/clip.mov');
    expect(materializedAssetPath('/tmp/handoff/media', 'file:///Users/me/clip.mov', 'clip.mov')).toBe('/Users/me/clip.mov');
    expect(materializedAssetPath('/tmp/handoff/media', 'https://media.example/clip.mov', 'clip.mov')).toBe('/tmp/handoff/media/clip.mov');
  });

  it('replaces every opaque asset token with a file URL', () => {
    expect(replaceAssetTokens('A={{asset:0}} B={{asset:1}}', [
      { token: '{{asset:0}}', path: '/tmp/A Clip.mov' },
      { token: '{{asset:1}}', path: '/tmp/B.mov' },
    ])).toBe('A=file:///tmp/A%20Clip.mov B=file:///tmp/B.mov');
  });
});
