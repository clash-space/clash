import { describe, expect, it } from 'vitest';

import { BuiltinProviderSchema } from './models';

/**
 * Reaching Google through Cloudflare's AI Gateway is a different account, not a second key.
 *
 * The three axes are provider (whose credential authenticates), upstreamId (which vendor answers)
 * and apiShape (what format is spoken). Going through the gateway changes only the first: Google
 * still answers, still in the same format, but the credential presented is Cloudflare's and the
 * Google key is held by Cloudflare rather than by us.
 *
 * Modelled as a second credential on the Google account it produced two runtime rules that exist
 * to patch the wrong shape — one refusing both credentials at once, one requiring the base url's
 * hostname to be literally `gateway.ai.cloudflare.com`. A credential whose validity depends on what
 * another credential's value looks like is a sign the account was split along the wrong seam.
 */
describe('cloudflare ai gateway is its own provider', () => {
  it('is a provider id', () => {
    expect(BuiltinProviderSchema.safeParse('cloudflare-ai-gateway').success).toBe(true);
  });

  it('does not replace the direct Google account', () => {
    // Both remain reachable. A user holding a Google key must not be forced through a gateway.
    expect(BuiltinProviderSchema.safeParse('official').success).toBe(true);
  });
});
