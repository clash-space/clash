import type { PluginAuthDeclaration } from "@clash/shared-types";

/**
 * What a Provider says its settings may be.
 *
 * There were three answers to "what services does MiniMax have" in this repository at once: a table
 * in this CLI saying `global` and `cn`, a table in shared-types, and the Provider's own form saying
 * `international` and `domestic`. The CLI's copy is what `--service` validated against, so both
 * spellings the Provider actually understands were rejected, with a message naming two values the
 * vendor does not have.
 *
 * A declaration the host reads for rendering but not for validation is half a declaration. The same
 * form drives both, or they drift -- and they had.
 */

/**
 * Every field any method declares.
 *
 * `--set key=value` names a key, not a way in, so a key is settable when *some* method asks for it.
 * Reading a Provider-level `form` was right when there was one; a Provider now declares `methods`,
 * each a whole configuration, and Google's three do not share a field list -- AI Studio has no
 * region, and a service account must not be offered a service.
 */
function declaredFields(
  declaration: PluginAuthDeclaration | undefined,
): NonNullable<NonNullable<PluginAuthDeclaration["methods"]>[number]["form"]> {
  return (declaration?.methods ?? []).flatMap((method) => method.form ?? []);
}

export function declaredChoices(
  declaration: PluginAuthDeclaration | undefined,
  key: string,
): string[] | undefined {
  const item = declaredFields(declaration).find(
    (candidate) => "key" in candidate && candidate.key === key,
  );
  // Free-text fields have no menu. Offering "known values" for one would invent a choice the
  // Provider never declared.
  if (!item || item.kind !== "choice") return undefined;
  return item.options.map((option) => option.value);
}

export function assertDeclaredSetting(
  declaration: PluginAuthDeclaration | undefined,
  key: string,
  value: string | undefined,
): void {
  // A declared default covers an unset value, which is what makes a setting optional.
  if (value === undefined) return;

  const declared = declaredFields(declaration).find(
    (candidate) => "key" in candidate && candidate.key === key,
  );
  if (!declared) {
    // "Runs one service" was a claim about the vendor. What was actually true was that this CLI had
    // no row for it. Storing an undeclared key would leave the operator believing they configured
    // something no Provider reads.
    throw new Error(
      `This provider does not declare a ${key} setting, so there is nothing to set it to.`,
    );
  }

  // A free-text field has no menu, and inventing one would reject valid values -- an api key is
  // whatever the vendor issued.
  const choices = declaredChoices(declaration, key);
  if (!choices) return;
  if (!choices.includes(value)) {
    throw new Error(
      `This provider has no ${key} "${value}". It declares: ${choices.join(", ")}.`,
    );
  }
}
