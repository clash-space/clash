import { describe, expect, it } from 'vitest';

import { MINIMAX_ENDPOINTS, minimaxBaseUrl } from './minimax-region';

/**
 * MiniMax answers on two hosts, and which one works depends on where you are.
 *
 * `api.minimax.io` serves the international account; `api.minimaxi.com` serves the domestic one.
 * They are not mirrors sharing a login — an account issued for one is not recognised by the other,
 * so picking the wrong host does not degrade, it refuses.
 *
 * Only the international host was ever written down, in four places, and the domestic one appeared
 * nowhere in the repository. That is not a default anyone chose; it is a default nobody noticed,
 * and it makes the product unusable for the accounts it was named after.
 */
describe('minimax region', () => {
  it('offers both hosts', () => {
    expect(Object.keys(MINIMAX_ENDPOINTS).sort()).toEqual(['cn', 'global']);
  });

  it('sends a global account to minimax.io', () => {
    expect(minimaxBaseUrl('global')).toBe('https://api.minimax.io');
  });

  it('sends a domestic account to minimaxi.com', () => {
    // The letter that distinguishes them is easy to lose in review; this is the assertion that
    // fails if it ever is.
    expect(minimaxBaseUrl('cn')).toBe('https://api.minimaxi.com');
  });

  it('keeps an explicit override, which is what a proxy or a gateway is', () => {
    expect(minimaxBaseUrl('cn', 'https://gateway.internal/minimax/')).toBe('https://gateway.internal/minimax');
  });

  it('falls back to the international host when no region was recorded', () => {
    // Accounts predate this choice. Changing where they point without being asked would break the
    // ones that currently work, so an unset region keeps the host they were already using.
    expect(minimaxBaseUrl(undefined)).toBe('https://api.minimax.io');
  });

  it('refuses a region it does not serve rather than guessing a host', () => {
    // Quietly falling back would send a request somewhere the account is unknown, and the failure
    // would arrive as an authentication error naming neither the region nor the host.
    expect(() => minimaxBaseUrl('eu')).toThrow(/eu/);
  });
});
