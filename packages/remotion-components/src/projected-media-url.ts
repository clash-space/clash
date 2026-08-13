/**
 * Accept a media location already projected by the current Host.
 *
 * Renderers must not infer an object-store route from a bare key: URL signing,
 * authorization, and storage topology belong to the Host projection layer.
 */
export function resolveProjectedMediaUrl(
  value: string | null | undefined,
): string {
  const source = value?.trim();
  if (!source) return "";
  if (source.startsWith("/projects/")) return "";
  if (source.startsWith("/")) return source;
  return /^(?:https?:|blob:|data:|file:)/i.test(source) ? source : "";
}
