import { describe, expect, it } from 'vitest';

import { authFormControls } from './auth-form.js';
import type { PluginAuthDeclaration } from './plugin-auth.js';

/**
 * The form the GUI draws comes from the provider's declaration.
 *
 * It used to come from `ACCOUNT_SETTINGS.minimax?.[0]` -- a host-side table, read by index. A vendor
 * reordering its own fields would have moved the label onto the wrong control, and adding a
 * provider meant editing this file.
 *
 * Now the provider declares `{ kind, key, label, ... }` and this turns it into controls. What the
 * host still owns is how a control looks and that a required one is marked; what it no longer owns
 * is which controls exist.
 *
 * The declaration these cases feed used to be a flat `{ form: [...] }`. It is `{ methods: [...] }`
 * now, each method a whole configuration, so every case below wraps its form in one. Which method
 * gets rendered is `auth-methods.test.ts`; what a single control looks like once chosen is here.
 */

/** One method around a form, so each case says what it is about and not how methods work. */
const declaring = (
  form: unknown[],
  extra: Record<string, unknown> = {},
): PluginAuthDeclaration => ({
  methods: [{ id: 'only', label: 'Only way in', form, ...extra }],
}) as PluginAuthDeclaration;

describe('authFormControls', () => {
  it('turns a field into a text control, masked when secret', () => {
    const [control] = authFormControls(
      declaring([{ kind: 'field', key: 'apiKey', label: 'API key', secret: true }]),
    );
    expect(control).toMatchObject({ control: 'text', key: 'apiKey', label: 'API key', masked: true });
  });

  it('turns a choice into a select carrying its own options', () => {
    const [control] = authFormControls(declaring([{
      kind: 'choice',
      key: 'region',
      label: 'Region',
      options: [{ value: 'global', label: 'Global' }],
      default: 'global',
    }]));
    expect(control).toMatchObject({ control: 'select', key: 'region', value: 'global' });
    expect((control as { options: unknown[] }).options).toHaveLength(1);
  });

  it('marks a control required when the declaration gives no default', () => {
    // A field with no declared default is required: unset means the account does not work. That
    // rule lives in the declaration, so the form and the request agree about the same fact.
    const controls = authFormControls(declaring([
      { kind: 'field', key: 'apiKey', label: 'API key', secret: true },
      { kind: 'field', key: 'baseUrl', label: 'Base URL', default: '' },
    ]));
    expect(controls[0]).toMatchObject({ key: 'apiKey', required: true });
    expect(controls[1]).toMatchObject({ key: 'baseUrl', required: false });
  });

  it('renders a notice as text with no key to store', () => {
    const [control] = authFormControls(
      declaring([{ kind: 'notice', text: 'Create one at aistudio.google.com/apikey' }]),
    );
    expect(control).toMatchObject({ control: 'notice' });
    expect(control).not.toHaveProperty('key');
  });

  it('shows a button only when a flow exists for it to start', () => {
    // A button that starts nothing is a control the user can press to no effect. The flow sits on
    // the method beside the button now, which is the pairing this case was always describing.
    const button = [{ kind: 'button', key: 'signIn', label: 'Sign in with Google' }];

    expect(authFormControls(declaring(button))).toHaveLength(0);

    const withFlow = authFormControls(declaring(button, {
      flow: { open: 'https://accounts.google.com/o/oauth2/v2/auth', callback: { type: 'loopback' } },
    }));
    expect(withFlow[0]).toMatchObject({ control: 'button', key: 'signIn' });
  });

  it('prefers a stored value over the declared default', () => {
    const [control] = authFormControls(
      declaring([{
        kind: 'choice',
        key: 'region',
        label: 'Region',
        options: [{ value: 'global', label: 'Global' }, { value: 'us-central1', label: 'us-central1' }],
        default: 'global',
      }]),
      { region: 'us-central1' },
    );
    expect(control).toMatchObject({ value: 'us-central1' });
  });

  it('prefers a stored value over the declared default for a field too', () => {
    // Written after a mutation test: the choice branch was covered and the field branch was not, so
    // a form could have redrawn a saved base url as the empty default without failing anything.
    const [control] = authFormControls(
      declaring([{ kind: 'field', key: 'baseUrl', label: 'Base URL', default: 'https://a.test' }]),
      { baseUrl: 'https://saved.test' },
    );
    expect(control).toMatchObject({ value: 'https://saved.test' });
  });

  it('answers nothing for a provider that declares no auth', () => {
    // A local model has no credential, and drawing an empty form section for it would suggest
    // there is something to fill in.
    expect(authFormControls(undefined)).toEqual([]);
  });
});
