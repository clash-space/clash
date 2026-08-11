import { describe, expect, it } from 'vitest';

import {
  credentialSourceKind,
  hasUnattendedCredentialSource,
  resolveCredentialSources,
} from './credential-sources';
import {
  ExecutablePluginProviderAuthSchema,
  ExecutablePluginProviderDefinitionSchema,
  resolveModelBindingFromProvider,
} from './executable-plugin';

const parse = (value: unknown) => ExecutablePluginProviderAuthSchema.parse(value);

/**
 * The Vertex shape: what the user stores is not what goes on the wire.
 *
 * A service account key holds an RSA private key. The wire credential is a bearer token minted by
 * signing a JWT with that key and exchanging it at Google's token endpoint (RFC 7523). The token
 * lives about an hour; the key lives until it is revoked.
 */
const serviceAccountAuthInput = {
  type: 'derived-token',
  id: 'vertex',
  label: 'Service account key',
  credentialId: 'serviceAccountKey',
  derivation: {
    kind: 'jwt-bearer-assertion',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  },
};
const serviceAccountAuth = parse(serviceAccountAuthInput);

/**
 * A credential that is derived per use rather than stored.
 *
 * Every existing kind stores the thing it sends: a pasted key, a captured bearer, a token read out
 * of an installed app. Vertex does not. The durable secret is a signing key, and the credential the
 * provider accepts is minted from it and expires in about an hour.
 *
 * This did not matter while a generation was one call. The host minted a token, held it across a
 * nine-minute retry loop, and the loop ended long before the token did. Submit-then-poll broke that:
 * a poll can land hours after the submit, or after a restart, and a token minted at submit time is
 * dead by then.
 *
 * Bridging the gap by saving the token is the one thing that must not happen. Poll state is
 * persisted beside the node in the canvas document, so a bearer written there is replicated, synced,
 * and backed up with the project -- a leak with a long tail, from a value that was only ever meant
 * to survive an hour.
 */
describe('derived-token credential source', () => {
  it('classifies a per-use derivation as its own kind', () => {
    // Not `api-key`: that kind's stored value is the credential, so a host may forward it verbatim.
    // Reusing the name would make "forward what is stored" true for one member and catastrophic for
    // the other -- the private key would go out as a bearer token.
    expect(credentialSourceKind(serviceAccountAuth)).toBe('derived-token');
  });

  it('renders as a field and needs no human at call time', () => {
    const [source] = resolveCredentialSources([serviceAccountAuth]);
    expect(source.control).toBe('field');
    expect(source.interactive).toBe(false);
    // A machine credential is the most unattended kind there is: it exists precisely so no human has
    // to be present. A provider offering only this still has an unattended path.
    expect(hasUnattendedCredentialSource([serviceAccountAuth])).toBe(true);
  });

  it('points at the durable secret the user actually fills in', () => {
    // The other kinds all converge on `apiKey`. This one does not: what is stored is a service
    // account document, and calling it `apiKey` would invite code to send it as one.
    const [source] = resolveCredentialSources([serviceAccountAuth]);
    expect(source.credentialId).toBe('serviceAccountKey');
  });

  it('tells host code that the stored secret cannot be sent as-is', () => {
    // The fact everything downstream branches on. Without it, "inject the stored credential" is a
    // single uniform rule that is correct for three kinds and leaks a private key on the fourth.
    const [derived] = resolveCredentialSources([serviceAccountAuth]);
    const [pasted] = resolveCredentialSources([parse({ type: 'api-key' })]);
    expect(derived.derivesCredential).toBe(true);
    expect(pasted.derivesCredential).toBe(false);
  });

  it('declares a recipe and has nowhere to put a value', () => {
    // A manifest is authored by a plugin and readable by anyone who installs it. If a token or key
    // could be written inline it would ship in plaintext inside the package, and the taxonomy would
    // be describing a secret store rather than an acquisition route.
    for (const smuggled of [
      { privateKey: '-----BEGIN PRIVATE KEY-----' },
      { token: 'ya29.a0Af' },
      { clientEmail: 'svc@p.iam.gserviceaccount.com', privateKey: 'k' },
    ]) {
      expect(
        ExecutablePluginProviderAuthSchema.safeParse({ ...serviceAccountAuth, ...smuggled }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
    }
  });

  it('offers no field a minted token could be parked in', () => {
    // The structural half of "never persist the derived credential": code cannot save what the type
    // has no slot for. A resolved source describes how to obtain a credential and never carries one.
    const [source] = resolveCredentialSources([serviceAccountAuth]);
    expect(Object.keys(source).sort()).toEqual([
      'auth',
      'control',
      'credentialId',
      'derivesCredential',
      'id',
      'interactive',
      'kind',
      'label',
    ]);
  });

  it('keeps derivation mechanisms a closed set', () => {
    // Same reason acquisition is closed: these are declared by third-party plugins but executed by
    // the host, which has to hold the signing key to run them. An open field would be a plugin
    // naming a signing scheme no one implements -- discovered when a generation fails.
    expect(ExecutablePluginProviderAuthSchema.safeParse({
      ...serviceAccountAuth,
      derivation: { ...serviceAccountAuthInput.derivation, kind: 'curl | sh' },
    }).success).toBe(false);
  });

  it('makes a route wait for the key the way it waits for a login', () => {
    // A binding cannot run before its credential exists, and that is already how a captured login is
    // treated. A signing key is no different: without it there is nothing to mint from.
    const provider = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'vertex',
      name: 'Google Cloud Agent Platform',
      upstreamId: 'vertex',
      apiShape: 'google-agent-platform',
      executorExportId: 'vertex-generate',
      auth: [serviceAccountAuth],
    });
    const binding = resolveModelBindingFromProvider(
      { modelId: 'gemini-3-flash', upstreamModel: 'gemini-3-flash-preview' },
      provider,
    );
    expect(binding.requiredOAuth).toEqual(['vertex']);
  });
});
