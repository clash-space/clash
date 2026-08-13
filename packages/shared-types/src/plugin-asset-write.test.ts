import { describe, expect, it } from 'vitest';

import {
  ExecutablePluginBrokerOperationSchema,
  uploadTargetForRuntime,
} from './executable-plugin.js';

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
 * A result URL is an ingestion source, never an Asset projection. The Host fetches it into the
 * Project's staging store and the plugin receives only the resulting Asset handle. There is no
 * `reach` assertion for plugin code to make: the protocol accepts HTTPS ingestion sources and
 * never forwards this URL as the Asset identity.
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
    });
    expect(parsed).toMatchObject({ kind: 'asset.write' });
  });

  it('refuses the retired reach assertion', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      url: 'https://cdn.example/out.png',
      reach: 'public',
    })).toThrow();
  });

  it('refuses a plaintext ingestion source', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      url: 'http://cdn.example/out.png',
    })).toThrow();
  });

  it('refuses more than one source', () => {
    expect(() => ExecutablePluginBrokerOperationSchema.parse({
      ...base,
      url: 'https://cdn.example/out.png',
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
