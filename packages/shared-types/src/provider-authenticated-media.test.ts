import { describe, expect, it } from 'vitest';

import { ExecutablePluginOutputSchema } from './executable-plugin';

/**
 * A result URL that only the provider's own credential can open.
 *
 * Not every finished generation is published. Gemini leaves video in its Files API, where the
 * download needs the same key that made the request; Vertex answers from an endpoint that expects a
 * bearer token. A host that fetches those bare gets a 403 — after the render succeeded and was
 * billed, which is the expensive way to discover it.
 *
 * `reach` cannot answer this. It says whether an address can be handed to a third party, and this
 * address can: what it cannot do is be opened by an anonymous request. So the URL says which
 * credential opens it, and the host attaches one when it fetches.
 *
 * The plugin still never sees a token. It names the credential; the broker injects it. That rule
 * does not bend for downloads.
 */
describe('provider-authenticated results', () => {
  const base = {
    slot: 'media',
    kind: 'asset' as const,
    asset: {
      assetId: 'asset-1',
      kind: 'video' as const,
      uri: 'clash-asset://asset-1',
    },
  };

  it('accepts a url that the provider credential opens', () => {
    const parsed = ExecutablePluginOutputSchema.parse({
      ...base,
      asset: {
        ...base.asset,
        url: 'https://generativelanguage.googleapis.com/v1/files/abc:download',
        reach: 'public',
        credential: 'provider',
      },
    });
    expect(parsed.kind === 'asset' && parsed.asset.credential).toBe('provider');
  });

  it('defaults to an anonymous fetch, which is what a CDN link needs', () => {
    const parsed = ExecutablePluginOutputSchema.parse({
      ...base,
      asset: { ...base.asset, url: 'https://cdn.example/out.mp4', reach: 'public' },
    });
    expect(parsed.kind === 'asset' && parsed.asset.credential).toBeUndefined();
  });

  it('refuses to name a credential for bytes, which have no address to open', () => {
    expect(ExecutablePluginOutputSchema.safeParse({
      ...base,
      asset: { ...base.asset, credential: 'provider' },
    }).success).toBe(false);
  });

  it('rejects a credential the host cannot supply', () => {
    // A closed set: the host holds provider credentials and nothing else, so a plugin naming its own
    // would be naming something no one can inject.
    expect(ExecutablePluginOutputSchema.safeParse({
      ...base,
      asset: {
        ...base.asset,
        url: 'https://example.test/out.mp4',
        reach: 'public',
        credential: 'my-own-token',
      },
    }).success).toBe(false);
  });
});
