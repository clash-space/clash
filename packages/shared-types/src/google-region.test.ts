import { describe, expect, it } from 'vitest';

import { googleApiBaseUrl } from './google-platform.js';
import { ACCOUNT_SETTINGS } from './account-settings.js';

/**
 * Service and region are two settings, and conflating them broke both.
 *
 * The service is which of Google's two surfaces issued the key — a fact about the credential. The
 * region is where Agent Platform runs the request, and it is a real Google configuration with real
 * consequences: `gemini-3.1-flash-image` answers on `global` and returns 404 on `us-central1`,
 * measured against the live API.
 *
 * Storing the service in the region column made an account read `region: 'agent-platform'`, which
 * matched no route, which resolved to nothing, which — before the fallback came out — produced a
 * placeholder and called it success.
 */
describe('google service and region', () => {
  it('are declared as separate settings', () => {
    const keys = (ACCOUNT_SETTINGS.google ?? []).map((setting) => setting.key);
    expect(keys).toContain('service');
    expect(keys).toContain('region');
  });

  it('sends a global account to the unprefixed host', () => {
    expect(googleApiBaseUrl('agent-platform', { location: 'global' }))
      .toBe('https://aiplatform.googleapis.com');
  });

  it('sends a located account to that location\'s host', () => {
    expect(googleApiBaseUrl('agent-platform', { location: 'us-central1' }))
      .toBe('https://us-central1-aiplatform.googleapis.com');
  });

  it('ignores region on the developer api, which has no locations', () => {
    expect(googleApiBaseUrl('ai-studio', { location: 'us-central1' }))
      .toBe('https://generativelanguage.googleapis.com');
  });
});
