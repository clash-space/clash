import { describe, expect, it } from 'vitest';

import {
  PROVIDER_LIFECYCLE_STATES,
  ProviderStatusMappingSchema,
  classifyProviderStatus,
} from './provider-status-vocabulary';

/**
 * We name the states; a plugin says which of its provider's words mean each one.
 *
 * Left to itself every plugin enumerates the words it happens to know — eleven, in the one that
 * shipped — and treats the rest as "not finished yet". That is the wrong default in the only
 * direction that matters. A status the list never learned, a new model's spelling, a terminal
 * failure phrased differently: each becomes an unbounded wait for work that already died.
 *
 * Inverting it costs a round trip when a plugin's mapping is incomplete, and saves an indefinite
 * wait when it is wrong. Those are not comparable.
 */
describe('provider status vocabulary', () => {
  it('names three states and no more', () => {
    expect([...PROVIDER_LIFECYCLE_STATES].sort()).toEqual(['completed', 'failed', 'running']);
  });

  const mapping = ProviderStatusMappingSchema.parse({
    running: ['IN_QUEUE', 'IN_PROGRESS'],
    completed: ['COMPLETED'],
    failed: ['FAILED', 'ERROR', 'CANCELED'],
  });

  it('classifies a status the plugin declared', () => {
    expect(classifyProviderStatus('IN_PROGRESS', mapping).state).toBe('running');
    expect(classifyProviderStatus('COMPLETED', mapping).state).toBe('completed');
    expect(classifyProviderStatus('FAILED', mapping).state).toBe('failed');
  });

  it('ignores case and surrounding space, which providers vary freely', () => {
    // Observed in the wild: a status arrives padded, and another provider lowercases the same word
    // between model families. Neither difference is meaningful, and a mapping that treats them as
    // unknown would strand ordinary work.
    expect(classifyProviderStatus('  completed  ', mapping).state).toBe('completed');
  });

  it('refuses to guess at a word it was not given', () => {
    // The whole point. Unknown is not running: a job in a state nobody described is a job nobody
    // can say is still alive.
    const verdict = classifyProviderStatus('THROTTLED_PENDING_REVIEW', mapping);
    expect(verdict.state).toBe('failed');
    expect(verdict.unmapped).toBe(true);
    expect(verdict.reason).toMatch(/THROTTLED_PENDING_REVIEW/);
  });

  it('rejects a mapping that claims a word for two states', () => {
    // One word, two meanings, and which one wins would depend on iteration order.
    expect(ProviderStatusMappingSchema.safeParse({
      running: ['PENDING'],
      completed: ['PENDING'],
      failed: ['FAILED'],
    }).success).toBe(false);
  });

  it('requires each state to have at least one word', () => {
    // A mapping with no failure words cannot ever report a failure, which is how a dead job polls
    // to the deadline instead of surfacing at once.
    expect(ProviderStatusMappingSchema.safeParse({
      running: ['IN_QUEUE'],
      completed: ['COMPLETED'],
      failed: [],
    }).success).toBe(false);
  });
});
