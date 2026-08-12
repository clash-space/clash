import { describe, expect, it } from 'vitest';

import {
  hasUnattendedCredentialSource,
  resolveCredentialSources,
  unattendedCredentialSources,
} from './credential-sources.js';
import { PluginAuthDeclarationSchema } from './plugin-auth.js';

const parse = (value: unknown) => PluginAuthDeclarationSchema.parse(value);

/**
 * The same provider `hilo-hub-media` declares, written the way a plugin declares it now.
 *
 * It used to be two entries in a union over auth types: an `oauth` entry naming a login
 * page and a custom URL scheme, and a `local-token-import` entry naming a path inside
 * another desktop app's encrypted config. Both were recipes the host executed, and each
 * needed a host release to add.
 *
 * Under the declarative model the plugin declares a button and a browser flow; reading
 * another app's store is plugin code, not a shape the host parses.
 */
const hiloAuth = parse({
  methods: [
    {
      id: 'only',
      label: 'Only',
      form: [
        { kind: 'button', key: 'accessToken', label: 'Sign in' },
      ],
      flow: {
        open: 'https://hub.minimax.io/login?device_id=clash-desktop&version_code=2.0.11',
        callback: { type: 'scheme', scheme: 'minimax-hub' },
      },
    },
  ],
});

const apiKeyAuth = parse({
  methods: [
    {
      id: 'only',
      label: 'Only',
      form: [
        { kind: 'field', key: 'apiKey', label: 'API key', secret: true },
        { kind: 'notice', text: 'Create one at aistudio.google.com/apikey' },
      ],
    },
  ],
});

describe('credential source classification', () => {
  it('reports a button behind a browser flow as a window', () => {
    // The old model asked which vendor this was -- `oauth` spelled one way meant a real
    // authorization-code flow, spelled another meant one vendor's redirect capture, and
    // telling them apart needed a member per vendor. What a caller needs to know is only
    // whether a browser window opens, and the declaration says that directly.
    expect(resolveCredentialSources(hiloAuth)[0].control).toBe('button-window');
  });

  it('reports a button with no flow as a host action', () => {
    const localOnly = parse({
      methods: [{
        id: 'only',
        label: 'Only',
        form: [{ kind: 'button', key: 'accessToken', label: 'Reuse local login' }],
      }],
    });
    expect(resolveCredentialSources(localOnly)[0].control).toBe('button-action');
  });

  it('reports a typed credential as a field', () => {
    expect(resolveCredentialSources(apiKeyAuth)[0].control).toBe('field');
  });

  it('reports a fixed menu as a field, because that is how it is drawn', () => {
    // `region` and `service` used to be columns the host understood. They are keys like
    // any other now, and a menu is a field with its values enumerated.
    const withRegion = parse({
      methods: [{
        id: 'only',
        label: 'Only',
          form: [{
            kind: 'choice',
            key: 'region',
            label: 'Region',
            options: [{ value: 'global', label: 'Global' }],
            default: 'global',
          }],
      }],
    });
    const [source] = resolveCredentialSources(withRegion);
    expect(source.control).toBe('field');
    expect(source.kind).toBe('choice');
  });
});

describe('uniform presentation', () => {
  it('keeps two sources of the same kind instead of collapsing them', () => {
    // Settings previously picked entries out with `find`, so a provider offering two
    // installed clients or two regions silently lost one.
    const twoKeys = parse({
      methods: [{
        id: 'only',
        label: 'Only',
          form: [
            { kind: 'field', key: 'accessKey', label: 'Access key', secret: true },
            { kind: 'field', key: 'secretKey', label: 'Secret key', secret: true },
          ],
      }],
    });
    expect(resolveCredentialSources(twoKeys).map((source) => source.id)).toEqual([
      'accessKey',
      'secretKey',
    ]);
  });

  it('preserves declared order', () => {
    const mixed = parse({
      methods: [{
        id: 'only',
        label: 'Only',
          form: [
            { kind: 'field', key: 'apiKey', label: 'API key', secret: true },
            { kind: 'button', key: 'accessToken', label: 'Sign in' },
          ],
          flow: { open: 'https://example.test/auth', callback: { type: 'loopback' } },
      }],
    });
    expect(resolveCredentialSources(mixed).map((source) => source.control)).toEqual([
      'field',
      'button-window',
    ]);
  });

  it('carries the originating item for host code that needs its fields', () => {
    const [source] = resolveCredentialSources(apiKeyAuth);
    expect(source.item.kind).toBe('field');
  });

  it('points every source at the key it populates', () => {
    // Sources no longer converge on a single `apiKey` field. They used to, because the
    // host injected one credential and the auth type decided how it was obtained; now the
    // plugin reads whichever keys it wrote, so the key is the identity of the source.
    expect(resolveCredentialSources(hiloAuth).map((s) => s.credentialId)).toEqual(['accessToken']);
    expect(resolveCredentialSources(apiKeyAuth).map((s) => s.credentialId)).toEqual(['apiKey']);
  });

  it('drops a notice, which explains a field rather than carrying one', () => {
    // Two items are declared and one is presentation. Emitting it as a source would put a
    // credential-shaped row in Settings with no value behind it.
    expect(resolveCredentialSources(apiKeyAuth)).toHaveLength(1);
  });

  it('uses the declared label', () => {
    // No default label any more. The old model had to invent one per auth type, because a
    // type is not a name a user recognises; a declaration states the label it wants.
    expect(resolveCredentialSources(hiloAuth)[0].label).toBe('Sign in');
    expect(resolveCredentialSources(apiKeyAuth)[0].label).toBe('API key');
  });

  it('reports which values must be stored encrypted and drawn masked', () => {
    // What survives of `derivesCredential`. That flag asked whether the stored secret
    // could be sent as-is, which the host no longer decides -- it stores opaque values and
    // the plugin decides what to do with them.
    expect(resolveCredentialSources(apiKeyAuth)[0].secret).toBe(true);
  });

  it('returns nothing for a provider that declares no auth', () => {
    // A local model has no credential. The field is optional, and absent has to mean an
    // empty list rather than a crash on the way to rendering Settings.
    expect(resolveCredentialSources(undefined)).toEqual([]);
    expect(hasUnattendedCredentialSource(undefined)).toBe(false);
  });
});

describe('unattended capability', () => {
  it('treats a browser flow as needing a human', () => {
    expect(unattendedCredentialSources(hiloAuth)).toEqual([]);
    expect(hasUnattendedCredentialSource(hiloAuth)).toBe(false);
  });

  it('treats a provisioned key as unattended', () => {
    // A pasted key needs a human once, but it can be provisioned ahead of time, so an
    // unattended caller is not blocked by it.
    expect(hasUnattendedCredentialSource(apiKeyAuth)).toBe(true);
  });

  it('treats a host-side button as unattended', () => {
    // Reading a token an installed app already holds needs nobody at the keyboard. It used
    // to be a declared recipe the host executed (`local-token-import`, naming a path inside
    // another app's encrypted config); it is plugin code now, and what the host sees is a
    // button with no flow behind it.
    const localOnly = parse({
      methods: [{
        id: 'only',
        label: 'Only',
        form: [{ kind: 'button', key: 'accessToken', label: 'Reuse local login' }],
      }],
    });
    expect(unattendedCredentialSources(localOnly).map((s) => s.control)).toEqual([
      'button-action',
    ]);
  });

  it('reports hilo as having no path that works without a browser', () => {
    // The finding the axis exists to surface, restated. hilo declares one route to a
    // credential and it opens a window, so a CLI or CI caller has nothing to use -- which
    // used to be discoverable only by watching a run fail.
    expect(hasUnattendedCredentialSource(hiloAuth)).toBe(false);
  });
});
