import { describe, expect, it } from 'vitest';

import { GOOGLE_PLATFORMS, googleApiBaseUrl } from './google-platform.js';

/**
 * One Google credential, two places it can be spent.
 *
 * Both surfaces now take an API key, so the credential no longer distinguishes them — which means
 * the account has to say which one it is, the same way a MiniMax account says which service issued
 * it. The endpoints are unrelated hosts and a key is accepted by one of them, so guessing produces
 * an authentication failure that names neither.
 *
 * This replaces a service-account JSON as the only way to reach Agent Platform: signing a JWT and
 * exchanging it for a scoped token is a much heavier gesture than pasting a key, and it required a
 * GCP project many people cannot create in their own organisation.
 */
describe('google platform choice', () => {
  it('offers both surfaces', () => {
    expect(Object.keys(GOOGLE_PLATFORMS).sort()).toEqual(['agent-platform', 'ai-studio']);
  });

  it('sends an AI Studio account to the developer API', () => {
    expect(googleApiBaseUrl('ai-studio')).toBe('https://generativelanguage.googleapis.com');
  });

  it('sends an Agent Platform account to aiplatform', () => {
    // The endpoint kept its name through the rename: it is a protocol fact, not a product name.
    expect(googleApiBaseUrl('agent-platform')).toBe('https://aiplatform.googleapis.com');
  });

  it('honours a regional Agent Platform host', () => {
    expect(googleApiBaseUrl('agent-platform', { location: 'us-central1' }))
      .toBe('https://us-central1-aiplatform.googleapis.com');
  });

  it('keeps an explicit base url, which is what a proxy is', () => {
    expect(googleApiBaseUrl('ai-studio', { baseUrl: 'https://proxy.internal/google/' }))
      .toBe('https://proxy.internal/google');
  });

  it('refuses a surface it does not serve rather than guessing a host', () => {
    expect(() => googleApiBaseUrl('bedrock' as never)).toThrow(/bedrock/);
  });
});
