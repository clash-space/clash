export function withProjectSessionSearch(
  search: string,
  threadId: string | null,
): string {
  const params = new URLSearchParams(search);
  const normalized = threadId?.trim() ?? "";
  if (normalized) params.set("thread", normalized);
  else params.delete("thread");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function withoutInitialProjectPrompt(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("prompt");
  const next = params.toString();
  return next ? `?${next}` : "";
}
