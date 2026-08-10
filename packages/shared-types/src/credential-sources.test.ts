import { describe, expect, it } from 'vitest';

import {
  credentialSourceKind,
  hasUnattendedCredentialSource,
  resolveCredentialSources,
  unattendedCredentialSources,
} from './credential-sources';
import { ExecutablePluginProviderAuthSchema } from './executable-plugin';

const parse = (value: unknown) => ExecutablePluginProviderAuthSchema.parse(value);

// Verbatim from the installed `hilo-hub-media` plugin.
const hiloAuth = [
  parse({
    type: 'oauth',
    id: 'hilo-hub',
    flow: 'browser',
    authorizationUrl: 'https://hub.minimax.io/login?device_id=clash-desktop&version_code=2.0.11',
    callback: { type: 'custom-scheme', scheme: 'minimax-hub' },
    accessTokenField: 'accessToken',
  }),
  parse({
    type: 'local-token-import',
    id: 'hilo-hub',
    label: 'Reuse MiniMax Hub login',
    source: {
      format: 'electron-store-aes-256-gcm-v2',
      appDataSubdirectory: '@hilo/MiniMax Hub Global',
      configFile: 'hub-config-global.json',
      keyFile: '.token-key',
      tokenPath: ['tokens', 'accessToken'],
    },
  }),
];

describe('credential source classification', () => {
  it('reports a browser redirect capture as what it is', () => {
    // The entry is spelled `oauth`, but it carries no response_type, client_id, or
    // token_type, and its token field is configurable -- which only makes sense
    // absent a standard, since RFC 6749 fixes that name as `access_token`.
    expect(credentialSourceKind(hiloAuth[0])).toBe('login-page-capture');
  });

  it('reports a desktop-app import as a local store read', () => {
    expect(credentialSourceKind(hiloAuth[1])).toBe('local-app-store');
  });

  it('reports a static credential as an api key', () => {
    expect(credentialSourceKind(parse({ type: 'api-key' }))).toBe('api-key');
  });
});

describe('uniform presentation', () => {
  it('maps each kind to one of three controls', () => {
    const sources = resolveCredentialSources(hiloAuth);
    expect(sources.map((source) => source.control)).toEqual(['button-window', 'button-action']);
  });

  it('keeps two sources of the same kind instead of collapsing them', () => {
    // Settings previously picked entries out with `find`, so a provider offering two
    // installed clients or two regions silently lost one.
    const twoStores = [
      parse({
        type: 'local-token-import',
        id: 'hub-global',
        label: 'Hub Global',
        source: {
          format: 'electron-store-aes-256-gcm-v2',
          appDataSubdirectory: 'a',
          configFile: 'c.json',
          keyFile: 'k',
          tokenPath: ['t'],
        },
      }),
      parse({
        type: 'local-token-import',
        id: 'hub-cn',
        label: 'Hub CN',
        source: {
          format: 'electron-store-aes-256-gcm-v2',
          appDataSubdirectory: 'b',
          configFile: 'c.json',
          keyFile: 'k',
          tokenPath: ['t'],
        },
      }),
    ];
    expect(resolveCredentialSources(twoStores).map((source) => source.id)).toEqual([
      'hub-global',
      'hub-cn',
    ]);
  });

  it('preserves declared order', () => {
    expect(resolveCredentialSources(hiloAuth).map((source) => source.kind)).toEqual([
      'login-page-capture',
      'local-app-store',
    ]);
  });

  it('carries the originating entry for host code that needs its fields', () => {
    const [capture] = resolveCredentialSources(hiloAuth);
    expect(capture.auth.type).toBe('oauth');
  });

  it('points every source at the credential the broker injects', () => {
    expect(resolveCredentialSources(hiloAuth).map((source) => source.credentialId)).toEqual([
      'apiKey',
      'apiKey',
    ]);
  });

  it('uses a declared label and falls back to a readable default', () => {
    const sources = resolveCredentialSources(hiloAuth);
    expect(sources[1].label).toBe('Reuse MiniMax Hub login');
    expect(sources[0].label).toBe('Sign in');
  });
});

describe('unattended capability', () => {
  it('treats a login page as needing a human', () => {
    expect(unattendedCredentialSources([hiloAuth[0]])).toEqual([]);
  });

  it('treats reading an installed app as unattended', () => {
    expect(unattendedCredentialSources([hiloAuth[1]]).map((s) => s.kind)).toEqual([
      'local-app-store',
    ]);
  });

  it('treats a provisioned api key as unattended', () => {
    expect(hasUnattendedCredentialSource([parse({ type: 'api-key' })])).toBe(true);
  });

  it('reports hilo as having no path that works without a desktop app', () => {
    // This is the finding the axis exists to surface: hilo declares two sources, and
    // the only unattended one requires the MiniMax Hub client to be installed and
    // logged in. A CLI or CI caller with neither has nothing to use, which used to be
    // discoverable only by watching a run fail.
    const unattended = unattendedCredentialSources(hiloAuth);
    expect(unattended.map((source) => source.kind)).toEqual(['local-app-store']);
    expect(hasUnattendedCredentialSource([hiloAuth[0]])).toBe(false);
  });
});
