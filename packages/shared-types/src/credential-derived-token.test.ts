import { describe, expect, it } from 'vitest';

import {
  hasUnattendedCredentialSource,
  resolveCredentialSources,
} from './credential-sources.js';
import {
  ExecutablePluginProviderDefinitionSchema,
  resolveModelBindingFromProvider,
} from './executable-plugin.js';
import { PluginAuthDeclarationSchema } from './plugin-auth.js';

const parse = (value: unknown) => PluginAuthDeclarationSchema.parse(value);

/**
 * The Vertex shape: what the user stores is not what goes on the wire.
 *
 * A service account key holds an RSA private key. The wire credential is a bearer token minted by
 * signing a JWT with that key and exchanging it at Google's token endpoint (RFC 7523). The token
 * lives about an hour; the key lives until it is revoked.
 *
 * This used to be a `derived-token` member of a union over auth types, carrying a `derivation`
 * recipe -- `jwt-bearer-assertion`, a token URL and a scope -- that the host executed while holding
 * the signing key. The recipe is gone. A registry over auth types needs a member per vendor, and
 * the members were already disagreeing: one provider signs each request with a key pair, another
 * wants a token copied from a console, and Google accepts several credential forms.
 *
 * What the provider declares now is a field to paste the document into. Signing the assertion and
 * exchanging it is the plugin's code, which is where it can be written once per vendor instead of
 * once per vendor *in the host*.
 */
const serviceAccountAuth = parse({
  methods: [
    {
      id: 'only',
      label: 'Only',
      form: [{
        kind: 'field',
        key: 'serviceAccountKey',
        label: 'Service account key',
        secret: true,
      }],
    },
  ],
});

describe('service account credential source', () => {
  it('renders as a field and needs no human at call time', () => {
    const [source] = resolveCredentialSources(serviceAccountAuth);
    expect(source.control).toBe('field');
    expect(source.interactive).toBe(false);
    // A machine credential is the most unattended kind there is: it exists precisely so no human has
    // to be present. A provider offering only this still has an unattended path.
    expect(hasUnattendedCredentialSource(serviceAccountAuth)).toBe(true);
  });

  it('points at the durable secret the user actually fills in', () => {
    // Sources used to converge on `apiKey` unless the auth type said otherwise, so this one needed a
    // special case to avoid inviting code to send a signing document as an api key. The key is the
    // identity of the source now, so there is no name for it to be given by default.
    const [source] = resolveCredentialSources(serviceAccountAuth);
    expect(source.credentialId).toBe('serviceAccountKey');
  });

  it('is stored encrypted and drawn masked', () => {
    // What survives of `derivesCredential`. That flag existed so host code could branch on "the
    // stored secret cannot be sent as-is" -- correct for three of five auth types and a leaked
    // private key on the fourth. The host does not make that decision any more: it stores an opaque
    // value and hands it back to the plugin that wrote it, so the only property left here is the one
    // the host does own.
    expect(resolveCredentialSources(serviceAccountAuth)[0].secret).toBe(true);
  });

  it('declares a form and has nowhere to put a value', () => {
    // A manifest is authored by a plugin and readable by anyone who installs it. If a token or key
    // could be written inline it would ship in plaintext inside the package, and the declaration
    // would be describing a secret store rather than a form. `.strict()` keeps that a validation
    // error rather than a secret shipped in a package.
    for (const smuggled of [
      { privateKey: '-----BEGIN PRIVATE KEY-----' },
      { token: 'ya29.a0Af' },
      { clientEmail: 'svc@p.iam.gserviceaccount.com' },
    ]) {
      expect(
        PluginAuthDeclarationSchema.safeParse({ ...serviceAccountAuth, ...smuggled }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
      expect(
        PluginAuthDeclarationSchema.safeParse({
          methods: [{
            ...serviceAccountAuth.methods[0]!,
            form: [{ ...serviceAccountAuth.methods[0]!.form![0]!, ...smuggled }],
          }],
        }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
    }
  });

  it('offers no field a minted token could be parked in', () => {
    // The structural half of "never persist the derived credential": code cannot save what the type
    // has no slot for. A resolved source describes how to obtain a credential and never carries one,
    // which matters because poll state is persisted beside the node in the canvas document -- a
    // bearer written there is replicated, synced and backed up with the project, a leak with a long
    // tail from a value only ever meant to survive an hour.
    const [source] = resolveCredentialSources(serviceAccountAuth);
    expect(Object.keys(source).sort()).toEqual([
      'control',
      'credentialId',
      'id',
      'interactive',
      'item',
      'kind',
      'label',
      'secret',
    ]);
  });

  it('no longer constrains how a credential is derived, because the host no longer derives it', () => {
    // Reversed. This asserted that `derivation.kind` was a closed set, on the reasoning that a
    // plugin declares it but the host executes it, so an open field would name a scheme nobody
    // implements. Both halves of that reasoning are gone: there is no derivation field, and the host
    // executes nothing. A plugin that needs a JWT assertion writes one.
    //
    // What is given up is the schema catching a typo at install time. What is bought is that adding
    // a vendor whose signing scheme nobody anticipated does not require a host release.
    expect(PluginAuthDeclarationSchema.safeParse({
      ...serviceAccountAuth,
      derivation: { kind: 'jwt-bearer-assertion', tokenUrl: 'https://oauth2.googleapis.com/token' },
    }).success).toBe(false);
  });

  it('does not make a route wait for a credential the provider never named', () => {
    // Reversed. This asserted `requiredOAuth: ['vertex']` was inherited from the provider's auth,
    // derived from the `id` on each `oauth`, `derived-token` and `local-token-import` entry.
    //
    // The declarative model has no such ids. A provider declares form keys, an optional browser flow
    // and an optional renewal schedule -- none of which is a named acquisition a route can wait for,
    // so there is nothing left to derive. A binding that needs a route to wait states it itself,
    // which is what every binding shipped in-tree already does.
    const provider = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'vertex',
      name: 'Google Cloud Agent Platform',
      upstreamId: 'vertex',
      apiShape: 'google-agent-platform',
      executorExportId: 'vertex-generate',
      auth: serviceAccountAuth,
    });
    const inherited = resolveModelBindingFromProvider(
      { modelId: 'gemini-3-flash', upstreamModel: 'gemini-3-flash-preview' },
      provider,
    );
    expect(inherited.requiredOAuth).toBeUndefined();

    const stated = resolveModelBindingFromProvider(
      {
        modelId: 'gemini-3-flash',
        upstreamModel: 'gemini-3-flash-preview',
        requiredOAuth: ['vertex'],
      },
      provider,
    );
    expect(stated.requiredOAuth).toEqual(['vertex']);
  });
});
