export const MINIMAX_DEFAULT_TIMEOUT_MS = 30 * 60_000;

/** Resolve the production timeout shared by MiniMax's stdio and host layers. */
export function minimaxTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLASH_MINIMAX_TIMEOUT_MS?.trim();
  if (!raw) return MINIMAX_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("CLASH_MINIMAX_TIMEOUT_MS must be a positive integer");
  }
  return timeoutMs;
}
