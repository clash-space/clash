export const ACP_AUTH_REQUIRED_CODE = -32000;

export function isAuthRequired(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === ACP_AUTH_REQUIRED_CODE,
  );
}
