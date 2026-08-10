import { describe, expect, it } from 'vitest';

import { ExecutablePluginAssetReadResultSchema } from './executable-plugin';

/**
 * A URL must say who can fetch it.
 *
 * "URL" is not one thing. A local asset can be served at `http://127.0.0.1:<port>/assets/...`,
 * which the plugin can fetch because it runs on the same machine, and which the provider
 * cannot. A hosted asset has a URL the provider can fetch directly. Both are `https?://`
 * strings, and the plugin forwards those upstream unchanged:
 *
 *   if (/^https?:\/\//i.test(value)) return value;
 *
 * So an unlabelled local URL would be handed to the provider, which either fails or reaches
 * some unrelated service on its own loopback. `inlineLoopbackReference` exists in the host
 * precisely because of this distinction; the protocol has to carry it instead of every layer
 * rediscovering it.
 *
 * The matrix this closes -- our asset is local or public, the provider takes base64, a public
 * URL, or an upload endpoint -- has one impossible cell: a local asset and a provider that
 * only fetches URLs. Naming the reach is what lets a plugin detect that cell and upload
 * instead of forwarding something unreachable.
 */
describe('asset read results state the reach of a URL', () => {
  const base = { handle: 'clash-plugin-asset://abc', kind: 'image' as const, byteLength: 1024 };

  it('accepts a public URL the provider can fetch', () => {
    const parsed = ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      url: 'https://assets.example/abc?sig=1',
      reach: 'public',
    });
    expect(parsed.reach).toBe('public');
  });

  it('accepts a private URL only the plugin can fetch', () => {
    const parsed = ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      url: 'http://127.0.0.1:57767/assets/local-gen-34019861.png',
      reach: 'private',
    });
    expect(parsed.reach).toBe('private');
  });

  it('refuses a URL whose reach is unstated', () => {
    expect(() => ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      url: 'https://assets.example/abc',
    })).toThrow(/reach/i);
  });

  it('refuses a reach on a result that carries bytes', () => {
    // Bytes have no reach; claiming one would suggest a URL that does not exist.
    expect(() => ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      dataBase64: 'AAAA',
      reach: 'public',
    })).toThrow(/reach/i);
  });
});
