import type { PluginAuthDeclaration, PluginAuthFormItem } from './plugin-auth.js';

/**
 * Reading a Provider's declared account form, for whatever is asking.
 *
 * This lived in web-ui, so the settings screen drove the declaration and the CLI could not: it
 * accepted `--set key=value` and had no way to reach a Provider whose declaration is a browser
 * flow. Writing a second reader for the CLI is what produced the deleted `SERVICES` table, which
 * claimed MiniMax ran `global`/`cn` while the Provider declared `international`/`domestic` --
 * rejecting both values it actually understood.
 *
 * The CLI is a different rendering of the same form, so it reads it through the same function.
 */

/**
 * The controls to draw for one provider's account form.
 *
 * They used to come from `ACCOUNT_SETTINGS.<providerId>?.[0]` -- a host-side table, read by index.
 * A vendor reordering its own fields would have moved the label onto the wrong control, and adding
 * a provider meant editing the settings screen.
 *
 * Now the provider declares what it needs and this turns the declaration into controls. What the
 * host still owns is how a control looks and that a required one is marked. What it no longer owns
 * is which controls exist, or what any of the values mean.
 */

export type AuthFormControl =
  | {
    control: 'text';
    key: string;
    label: string;
    masked: boolean;
    required: boolean;
    value: string;
    placeholder?: string;
  }
  | {
    control: 'select';
    key: string;
    label: string;
    required: boolean;
    value: string;
    options: { value: string; label: string }[];
  }
  | { control: 'notice'; text: string }
  | { control: 'button'; key: string; label: string }
  | { control: 'code'; key: string; label: string; value: string };

export function authFormControls(
  declaration: PluginAuthDeclaration | undefined,
  stored: Record<string, string> = {},
  methodId?: string,
): AuthFormControl[] {
  if (!declaration) return [];

  // One method's fields, never the union of them. `service` belongs to the API key method and not
  // to the service account one; rendering both together is what invited an account whose settings
  // contradicted each other, with the contradiction surfacing as an auth failure from the vendor
  // rather than from the form that already knew.
  const method = methodId
    ? declaration.methods.find((candidate) => candidate.id === methodId)
    : declaration.methods[0];
  if (!method) return [];

  const controls: AuthFormControl[] = [];
  for (const item of method.form ?? []) {
    const control = controlFor(item, method, stored);
    if (control) controls.push(control);
  }
  return controls;
}

function controlFor(
  item: PluginAuthFormItem,
  method: { flow?: unknown },
  stored: Record<string, string>,
): AuthFormControl | undefined {
  switch (item.kind) {
    case 'field':
      return {
        control: 'text',
        key: item.key,
        label: item.label,
        masked: item.secret === true,
        // A field with no declared default is required: unset means the account does not work. The
        // rule lives in the declaration so the form and the request agree about the same fact.
        required: item.default === undefined,
        value: stored[item.key] ?? item.default ?? '',
        ...(item.placeholder ? { placeholder: item.placeholder } : {}),
      };

    case 'choice':
      return {
        control: 'select',
        key: item.key,
        label: item.label,
        required: item.default === undefined,
        value: stored[item.key] ?? item.default ?? '',
        options: [...item.options],
      };

    case 'notice':
      return { control: 'notice', text: item.text };

    case 'button':
      // A button that starts nothing is a control the user can press to no effect. The flow is what
      // it starts, so without one there is nothing to draw.
      if (!method.flow) return undefined;
      return { control: 'button', key: item.key, label: item.label };

    case 'display-code':
      return {
        control: 'code',
        key: item.key,
        label: item.label,
        value: stored[item.key] ?? '',
      };
  }
}

/**
 * Which declared keys are still empty.
 *
 * Used to tell the user why an account is not usable yet, before a generation fails somewhere else
 * for a reason that names a vendor error rather than a missing field.
 */
export function missingAuthKeys(
  declaration: PluginAuthDeclaration | undefined,
  stored: Record<string, string> = {},
  methodId?: string,
): string[] {
  // Only the chosen method's fields. A flow-only method needs nothing collected -- what the flow
  // stores is the credential, and asking for a field beside it would be asking the user to do by
  // hand what signing in does.
  return authFormControls(declaration, stored, methodId)
    .filter((control): control is Extract<AuthFormControl, { required: boolean; key: string }> =>
      'required' in control && control.required)
    .filter((control) => !control.value.trim())
    .map((control) => control.key);
}
