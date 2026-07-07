export type DestructiveConfirmationResult =
  | { ok: true }
  | { ok: false; error: string };

export function requireDestructiveConfirmation(options: {
  yes?: boolean;
}, subject: string): DestructiveConfirmationResult {
  if (options.yes === true) return { ok: true };
  return {
    ok: false,
    error: `Refusing to delete ${subject} without --yes.`,
  };
}
