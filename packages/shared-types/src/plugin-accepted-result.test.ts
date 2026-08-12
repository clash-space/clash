import { describe, expect, it } from 'vitest';

import {
  ExecutablePluginResultSchema,
  ExecutablePluginInvocationSchema,
} from './executable-plugin.js';

/**
 * A plugin reports that the provider accepted the work, and the host owns the wait.
 *
 * Today a generation is one call that blocks until the upstream finishes -- up to fifteen minutes
 * for video -- so the upstream's task id exists only inside that call's stack. A host that stops
 * mid-flight cannot find the work again: the node stays `pending` forever and the generation has
 * already been billed. Every plugin also writes the same retry loop, because each one has to.
 *
 * Splitting submit from poll moves the loop to the host, which is the only party that can persist
 * it across a restart. The plugin keeps what is genuinely its own -- how to ask this provider
 * whether a task is done -- and loses the part that was never provider-specific: the schedule, the
 * retry budget, the durability.
 *
 * It also decides nothing about how the answer arrives. Polling and a cloud callback differ only in
 * what wakes the host, and the plugin's shape is identical either way.
 */
describe('accepted results', () => {
  const base = {
    protocol: 'clash.plugin.result/v1' as const,
    invocationId: 'inv-1',
  };

  it('takes whatever shape the provider needs to be asked again', () => {
    // An id, a status URL, a job name plus its region: the host stores each the same way because it
    // reads none of them. A `taskId` field would have made every provider without one invent it.
    for (const pollState of [
      'upstream-abc',
      { statusUrl: 'https://api.example.com/jobs/7' },
      { job: 'j-1', region: 'us-east-1' },
    ]) {
      expect(ExecutablePluginResultSchema.safeParse({
        ...base, status: 'accepted', pollState,
      }).success, JSON.stringify(pollState)).toBe(true);
    }
  });

  it('refuses an accepted result with no state to ask again with', () => {
    // The host would have been told to wait for something it cannot ask about: neither the result
    // nor a way to reach it.
    expect(ExecutablePluginResultSchema.safeParse({
      ...base,
      status: 'accepted',
    }).success).toBe(false);
  });

  it('still accepts a result that completed in one call', () => {
    // Fast providers answer immediately, and forcing a second round trip for them would be a cost
    // with no buyer.
    expect(ExecutablePluginResultSchema.safeParse({
      ...base,
      status: 'completed',
      outputs: [],
    }).success).toBe(true);
  });

  const invocation = {
    protocol: 'clash.plugin.invoke/v1' as const,
    invocationId: 'inv-2',
    taskId: 'task-1',
    projectId: 'proj-1',
    target: {
      pluginId: 'acme.p',
      version: '1.0.0',
      exportId: 'generate',
      schemaHash: `sha256:${'a'.repeat(64)}`,
      kind: 'provider-executor' as const,
    },
    input: { values: {}, references: [] },
    actor: { kind: 'agent' as const },
  };

  it('asks about accepted work with an explicit poll', () => {
    const parsed = ExecutablePluginInvocationSchema.parse({
      ...invocation,
      operation: 'poll',
      pollState: { statusUrl: 'https://api.example.com/jobs/7' },
    });
    expect(parsed.operation).toBe('poll');
  });

  it('defaults to submitting', () => {
    expect(ExecutablePluginInvocationSchema.parse(invocation).operation).toBe('submit');
  });

  it('refuses a poll that names no task, and a submit that names one', () => {
    // Inferring the operation from an absent field is how a status query becomes a second billed
    // submission.
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, operation: 'poll',
    }).success).toBe(false);
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, pollState: 'upstream-abc',
    }).success).toBe(false);
  });

  it('fits every way a provider can answer', () => {
    // Three patterns exist in the wild, and the protocol has to hold all of them without a mode
    // switch per provider.
    const answers = {
      // Fast provider: the one call carries the result. No state, no second round trip.
      synchronous: { ...base, status: 'completed', outputs: [] },
      // Slow provider: the host is told what to ask about, and asks on a timer.
      polled: { ...base, status: 'accepted', pollState: { job: 'j-1' } },
      // Callback provider: identical shape. What differs is that an inbound request wakes the host
      // instead of a timer, which is the host's business and invisible to the plugin.
      callback: { ...base, status: 'accepted', pollState: { subscription: 'sub-9' } },
    };
    for (const [name, answer] of Object.entries(answers)) {
      expect(ExecutablePluginResultSchema.safeParse(answer).success, name).toBe(true);
    }
  });

  it('lets a synchronous provider stay synchronous', () => {
    // Nothing forces acceptance. A provider that answers at once is not made to invent poll state,
    // and the host never enters a loop for it.
    const parsed = ExecutablePluginResultSchema.parse({ ...base, status: 'completed', outputs: [] });
    expect(parsed).not.toHaveProperty('pollState');
  });
});

/**
 * A callback is an unauthenticated stranger until something proves otherwise.
 *
 * The address is issued by the host, so it is task-scoped and hard to guess -- but it also travels
 * through the provider's logs and every proxy between, so secrecy alone is a thin defence. The real
 * check is the provider's signature, which arrives in headers and can only be verified by the
 * plugin that knows this provider's scheme.
 */
describe('callback safety', () => {
  const invocation = {
    protocol: 'clash.plugin.invoke/v1' as const,
    invocationId: 'inv-9',
    taskId: 'task-1',
    projectId: 'proj-1',
    target: {
      pluginId: 'acme.p',
      version: '1.0.0',
      exportId: 'generate',
      schemaHash: `sha256:${'a'.repeat(64)}`,
      kind: 'provider-executor' as const,
    },
    input: { values: {}, references: [] },
    actor: { kind: 'system' as const },
  };

  it('hands the plugin the headers it needs to verify a signature', () => {
    const parsed = ExecutablePluginInvocationSchema.parse({
      ...invocation,
      operation: 'callback',
      callbackPayload: { status: 'succeeded' },
      callbackHeaders: { 'x-provider-signature': 'sha256=abc', 'x-provider-timestamp': '1699999999' },
    });
    expect(parsed.callbackHeaders?.['x-provider-signature']).toBe('sha256=abc');
  });

  it('refuses a callback with no body to verify', () => {
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, operation: 'callback',
    }).success).toBe(false);
  });

  it('keeps callback fields off a submit or a poll', () => {
    // A stray payload on a poll would let a caller inside the host hand the plugin an unverified
    // message through a path that was never the callback path.
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, operation: 'poll', pollState: { job: 'j' }, callbackPayload: { status: 'ok' },
    }).success).toBe(false);
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, callbackHeaders: { 'x-provider-signature': 'sha256=abc' },
    }).success).toBe(false);
  });

  it('issues the callback address only when work is submitted', () => {
    // An address handed out later would be an address for work already under way, which is how one
    // task's callback settles another task.
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, callbackUrl: 'https://host.example/cb/abc',
    }).success).toBe(true);
    expect(ExecutablePluginInvocationSchema.safeParse({
      ...invocation, operation: 'poll', pollState: { job: 'j' },
      callbackUrl: 'https://host.example/cb/abc',
    }).success).toBe(false);
  });
});
