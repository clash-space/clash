import { describe, expect, it } from 'vitest';

import { MODEL_CARDS } from './models.js';

/**
 * One Google provider, because there is one way to authenticate.
 *
 * Verified against Google with a real key: both surfaces answer `:generateContent` with
 * `x-goog-api-key`, and the only difference is the host —
 *
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
 *
 * No project, no location, no service account, no signed JWT on either. Under the rule that the
 * same authentication method means the same provider, they stopped being two the moment Agent
 * Platform started taking keys.
 *
 * They were split because Agent Platform once required a service-account JSON exchanged for a
 * scoped token. That split cost a real generation: a Google account was configured, nano-banana-2
 * was requested, our own gate demanded a service account, found none, and hilo-hub answered
 * instead — indistinguishably.
 */
describe('google is one provider', () => {
  const googleRoutes = MODEL_CARDS.flatMap((card) =>
    (card.providerImplementations ?? []).filter((route) => /google/.test(route.upstreamId ?? '')),
  );

  it('has google routes to check', () => {
    expect(googleRoutes.length).toBeGreaterThan(0);
  });

  it('does not describe agent platform as a separate upstream', () => {
    const upstreams = [...new Set(googleRoutes.map((route) => route.upstreamId))].sort();
    expect(upstreams).not.toContain('google-agent-platform');
  });

  it('keeps a separate wire format only where the wire really differs', () => {
    // Interactions is a different endpoint and a different body, so it stays its own apiShape. That
    // is the wire axis, not the credential axis, and one provider may speak several.
    const shapes = [...new Set(googleRoutes.map((route) => route.apiShape))];
    expect(shapes).toContain('google-ai-studio-interactions');
  });
});
