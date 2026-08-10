import { describe, expect, it } from 'vitest';

import {
  ExecutablePluginBrokerOperationSchema,
  uploadTargetForRuntime,
} from './executable-plugin';

/**
 * A plugin hands a result back in whichever form it already has, and the host does the rest.
 *
 * Storing, content-addressing, and thumbnailing a result are the host's job, so the plugin only
 * has to say where the bytes are. Three answers are honest, and they are not alternatives -- each
 * covers a case the others handle badly:
 *
 *   bytes   the plugin computed the result itself; small, already in memory
 *   url     the upstream published it; the host fetches once, and the plugin never touches it
 *   upload  the plugin has bytes too large to pass inline, so it PUTs them where the host said
 *
 * `url` alone is not enough: it requires the host to reach an address the plugin chose. `upload`
 * inverts that -- the host issues the target, so it is reachable by construction, and the plugin
 * needs no idea whether it is running here or in someone else's cloud. That inversion is what
 * makes one code path serve both run modes.
 *
 * Before this, the only asset shapes were inline base64 and an internal output handle, so a plugin
 * whose upstream returned a CDN link had to smuggle it through a free-form `kind: "value"` output.
 * `hilo-hub-media` does exactly that, and pays for it: its media type is hardcoded per model kind
 * rather than read from the response, which is the same `audio/mpeg` guess that broke reference
 * audio at the other end of the pipe.
 */
describe('asset write accepts bytes, a URL, or an upload', () => {
  const base = { kind: 'asset.write' as const, slot: 'media', assetKind: 'image' as const };

  it('accepts inline bytes', () => {
    const parsed = ExecutablePluginBrokerOperationSchema.parse({ ...base, dataBase64: 'AAAA' });
    expect(parsed).toMatchObject({ kind: 'asset.write' });
  });

  it('accepts a URL the host can fetch', () => {
    const parsed = ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      mediaType: 'image/png',
      url: 'https://cdn.example/out.png',
      reach: 'public',
    });
    expect(parsed).toMatchObject({ kind: 'asset.write' });
  });

  it('refuses a URL whose reach is unstated', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      url: 'https://cdn.example/out.png',
    })).toThrow(/reach/i);
  });

  it('refuses more than one source', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      url: 'https://cdn.example/out.png',
      reach: 'public',
      dataBase64: 'AAAA',
    })).toThrow(/exactly one/i);
  });

  it('refuses no source at all', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse(base)).toThrow(/exactly one/i);
  });

  it('offers an upload target the plugin can always reach', () => {
    // The host issues the address, so reachability is settled by construction rather than by the
    // plugin guessing which world it is in.
    expect(uploadTargetForRuntime('local', {
      localBaseUrl: 'http://127.0.0.1:57767',
      publicUploadUrl: undefined,
    })).toBe('http://127.0.0.1:57767/plugin-uploads');

    expect(uploadTargetForRuntime('hosted', {
      localBaseUrl: 'http://127.0.0.1:57767',
      publicUploadUrl: 'https://uploads.example/presigned',
    })).toBe('https://uploads.example/presigned');
  });

  it('has no upload target for a hosted plugin when nothing public exists', () => {
    // Handing it the loopback address would point it at whatever answers on its own network.
    expect(uploadTargetForRuntime('hosted', {
      localBaseUrl: 'http://127.0.0.1:57767',
      publicUploadUrl: undefined,
    })).toBeUndefined();
  });
});
