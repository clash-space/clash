/**
 * Resolve a secret env var, refusing to silently fall back to a hardcoded
 * dev value in non-development environments.
 *
 * Pattern that this replaces — *unsafe* because prod misconfiguration becomes
 * silent global compromise:
 *
 *     const secret = env.JWT_SECRET || "dev-fallback";
 *
 * Use instead:
 *
 *     const secret = requireSecret(env, "JWT_SECRET", env.JWT_SECRET, "dev-fallback");
 */
export function requireSecret(
  env: { ENVIRONMENT: string },
  name: string,
  value: string | undefined,
  devFallback: string,
): string {
  if (value) return value;
  if (env.ENVIRONMENT === "development") return devFallback;
  throw new Error(
    `${name} is not configured — refusing to use a fallback secret in non-development environment`,
  );
}
