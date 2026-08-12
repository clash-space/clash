import { describe, expect, it } from 'vitest';

import { ACCOUNT_SETTINGS, resolveAccountSetting, resolveRequiredSetting, type AccountSetting } from './account-settings.js';

/**
 * A choice, its options and its default are one declaration, read by everyone.
 *
 * The default started as a constant in the request path, which put it in the one place the person
 * making the choice cannot see. The form would then have needed its own copy to pre-select
 * anything, and the two would drift the first time one changed — the same one-concept-two-sources
 * shape this codebase keeps undoing.
 *
 * So the declaration is data: what the setting is called, what it may be, and what it is when
 * nobody said. The form renders it, the host resolves against it, and neither owns it.
 */
describe('account setting declarations', () => {
  it('declares the Google surface as a choice', () => {
    const setting = ACCOUNT_SETTINGS.google?.find((entry) => entry.key === 'service');
    expect(setting?.options?.map((option) => option.value)).toEqual(['agent-platform', 'ai-studio']);
  });

  it('carries the default inside the declaration', () => {
    const setting = ACCOUNT_SETTINGS.google?.find((entry) => entry.key === 'service');
    // Agent Platform serves the whole catalogue -- Veo and the Gemini text models exist only there
    // -- while the Developer API additionally needs the Gemini API enabled on the key's project.
    expect(setting?.defaultValue).toBe('agent-platform');
  });

  it('resolves a stored value over the default', () => {
    expect(resolveAccountSetting('google', 'service', 'ai-studio')).toBe('ai-studio');
  });

  it('falls back to the declared default when nothing was stored', () => {
    expect(resolveAccountSetting('google', 'service', undefined)).toBe('agent-platform');
  });

  it('refuses a stored value the declaration does not list', () => {
    // A value outside the options would reach the request path and pick no host at all, failing as
    // an authentication error that names neither.
    expect(() => resolveAccountSetting('google', 'service', 'bedrock')).toThrow(/bedrock/);
  });
});

/**
 * A setting with no declared default is required, and an account missing it does not work.
 *
 * The alternative is what the code did before: resolve to undefined and carry on. Downstream that
 * became a host nobody chose, an authentication failure naming neither the setting nor the value,
 * and an account that reported itself as configured. The declaration is the only place that knows
 * whether absence is acceptable — a default means it is, and no default means it is not.
 */
describe('a setting without a default is required', () => {
  const required: AccountSetting = { key: 'workspace', label: 'Workspace' };

  it('is satisfied by a stored value', () => {
    expect(resolveRequiredSetting(required, 'w-1')).toBe('w-1');
  });

  it('refuses an account that never set it', () => {
    expect(() => resolveRequiredSetting(required, undefined)).toThrow(/Workspace/);
  });

  it('treats an empty string as unset, because a form submits one', () => {
    expect(() => resolveRequiredSetting(required, '   ')).toThrow(/Workspace/);
  });

  it('stays optional when a default is declared', () => {
    const optional: AccountSetting = { key: 'service', label: 'Service', defaultValue: 'global' };
    expect(resolveRequiredSetting(optional, undefined)).toBe('global');
  });
});
