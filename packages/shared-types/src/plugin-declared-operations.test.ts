import { describe, expect, it } from 'vitest';

import { ExecutablePluginFunctionExportSchema } from './executable-plugin';

/**
 * An entry point declares which operations it answers.
 *
 * Without it the host has to find out by asking: send a poll and see whether the plugin understands
 * it. That discovery happens after the work was submitted and paid for, which is the worst moment
 * to learn that nobody can collect the result.
 *
 * It also decides what the host offers. A callback address is only issued to an entry that says it
 * handles callbacks -- handing one to a plugin that ignores it produces a provider calling an
 * address nobody translates, and work that completes upstream while the node waits forever.
 */
describe('declared operations', () => {
  const base = { id: 'generate', kind: 'provider-executor' as const, handler: 'dist/index.js' };

  it('defaults to submit-only, which is what a synchronous provider needs', () => {
    // The simplest plugin says nothing and gets the simplest contract.
    expect(ExecutablePluginFunctionExportSchema.parse(base).operations).toEqual(['submit']);
  });

  it('lets an entry declare that it can be polled', () => {
    const parsed = ExecutablePluginFunctionExportSchema.parse({
      ...base,
      operations: ['submit', 'poll'],
    statusMapping: {
        running: ['PROCESSING'],
        completed: ['SUCCESS'],
        failed: ['FAILED'],
      },
      });
    expect(parsed.operations).toContain('poll');
  });

  it('requires submit, because nothing can be polled that was never started', () => {
    expect(ExecutablePluginFunctionExportSchema.safeParse({
      ...base,
      operations: ['poll'],
    }).success).toBe(false);
  });

  it('requires poll alongside callback', () => {
    // A callback that never arrives is a normal event, not an anomaly: providers drop them, and
    // networks partition. Without a poll to fall back on, the work is simply lost.
    expect(ExecutablePluginFunctionExportSchema.safeParse({
      ...base,
      operations: ['submit', 'callback'],
    }).success).toBe(false);
    expect(ExecutablePluginFunctionExportSchema.safeParse({
      ...base,
      operations: ['submit', 'poll', 'callback'],
    statusMapping: {
        running: ['PROCESSING'],
        completed: ['SUCCESS'],
        failed: ['FAILED'],
      },
      }).success).toBe(true);
  });

  it('rejects an operation the host has no meaning for', () => {
    expect(ExecutablePluginFunctionExportSchema.safeParse({
      ...base,
      operations: ['submit', 'stream'],
    }).success).toBe(false);
  });
});

/**
 * The declaration has to bind the host, or it is decoration.
 *
 * Two rules follow from it, and both protect against a silent loss rather than a loud one. A plugin
 * that accepts work it cannot be asked about leaves a paid generation with no way to collect it. A
 * host that issues a callback address to an entry that does not handle callbacks leaves the
 * provider talking to nobody.
 */
describe('the host honours the declaration', () => {
  // A pollable entry has to bring the vocabulary its provider answers in, so the factory supplies
  // one whenever poll is declared. Submit-only entries must not carry it: nothing would read it.
  const entry = (operations: string[]) => ExecutablePluginFunctionExportSchema.parse({
    id: 'generate', kind: 'provider-executor', handler: 'dist/index.js', operations,
    ...(operations.includes('poll')
      ? { statusMapping: { running: ['PROCESSING'], completed: ['SUCCESS'], failed: ['FAILED'] } }
      : {}),
  });

  it('marks a submit-only entry as unable to accept work', () => {
    // Nothing forbids returning `accepted` at the schema level -- the result schema does not know
    // which entry produced it -- so the host has to check, and this is the fact it checks against.
    expect(entry(['submit']).operations.includes('poll')).toBe(false);
    expect(entry(['submit', 'poll']).operations.includes('poll')).toBe(true);
  });

  it('marks which entries may be given a callback address', () => {
    expect(entry(['submit', 'poll']).operations.includes('callback')).toBe(false);
    expect(entry(['submit', 'poll', 'callback']).operations.includes('callback')).toBe(true);
  });
});
