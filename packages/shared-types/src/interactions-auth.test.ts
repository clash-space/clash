import { describe, expect, it } from 'vitest';

import { MODEL_CARDS } from './models.js';

/**
 * The Interactions API does not take an api key.
 *
 * Measured against Google with a working key, which generateContent accepts:
 *
 *   POST /v1beta1/projects/{p}/locations/global/interactions
 *     -> 401 "API keys are not supported by this API. Expected OAuth2 access token"
 *   POST /v1/.../models/gemini-omni-flash-preview:generateContent
 *     -> 400 "only supported in the Interactions API and cannot be called directly"
 *
 * So omni is reachable by exactly one route, and that route needs a token. The api-key path that now
 * serves the other thirteen Google models cannot serve this one, and a card claiming otherwise sends
 * someone to debug their key.
 *
 * This is also why the service-account path stays: it is the only unattended source of a token here.
 */
describe('the interactions surface', () => {
  const omni = MODEL_CARDS.find((card) => card.id === 'gemini-omni-flash');

  it('is still in the catalogue', () => {
    expect(omni).toBeDefined();
  });

  it('offers a credential for each surface that serves it', () => {
    const route = (omni?.providerImplementations ?? [])
      .find((candidate) => candidate.apiShape === 'google-ai-studio-interactions');
    expect(route).toBeDefined();
    const anyOf = (route?.credentialRequirements?.anyOf ?? []).map((set) => [...set].sort().join('+'));
    // Agent Platform takes a token, and a service account is the unattended way to hold one.
    expect(anyOf).toContain('serviceAccountKey');
    // The Developer API takes a key. Its endpoint answers 403 rather than 404, so it is real; asking
    // for a service account there would demand a credential that surface has no use for.
    expect(anyOf).toContain('apiKey');
  });
});
