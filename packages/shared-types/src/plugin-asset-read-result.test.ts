import { describe, expect, it } from 'vitest';

import { ExecutablePluginAssetReadResultSchema } from './executable-plugin';

/**
 * Resolving a reference may answer with bytes or with a URL.
 *
 * A plugin asks the broker to resolve `clash-asset://<id>` and must not care where the asset
 * lives. Today the local broker reads a file and returns bytes; a hosted broker holds the
 * asset in object storage and can hand back a short-lived URL, which is both cheaper and the
 * only workable answer once assets are large -- a Card may accept a 30 MB reference and
 * several of them.
 *
 * So the result carries either shape, and the plugin branches on what it received rather than
 * on whether it is running locally or in the cloud. Branching on topology would create the
 * second workflow the local-first model forbids.
 */
describe('asset read results describe bytes or a URL', () => {
  const base = { handle: 'clash-plugin-asset://abc', kind: 'image' as const, byteLength: 1024 };

  it('accepts inline bytes', () => {
    const parsed = ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      mediaType: 'image/png',
      dataBase64: 'AAAA',
    });
    expect(parsed.dataBase64).toBe('AAAA');
  });

  it('accepts a fetchable URL instead of bytes', () => {
    const parsed = ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      mediaType: 'image/png',
      url: 'https://assets.example/abc?sig=1',
      reach: 'public',
    });
    expect(parsed.url).toBe('https://assets.example/abc?sig=1');
  });

  it('rejects a result that offers neither', () => {
    expect(() => ExecutablePluginAssetReadResultSchema.parse(base))
      .toThrow(/exactly one of url or dataBase64/i);
  });

  it('rejects a result that offers both', () => {
    expect(() => ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      url: 'https://assets.example/abc',
      reach: 'public',
      dataBase64: 'AAAA',
    })).toThrow(/exactly one of url or dataBase64/i);
  });

  it('requires the URL to be fetchable by the plugin', () => {
    // A `clash-asset://` handle is not an answer: resolving one is the request itself.
    expect(() => ExecutablePluginAssetReadResultSchema.parse({
      ...base,
      url: 'clash-asset://abc',
      reach: 'public',
    })).toThrow();
  });
});
