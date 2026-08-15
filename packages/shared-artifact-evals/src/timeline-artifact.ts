function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Accept either a bare Timeline DSL document or the public Timeline entity
 * returned by Clash reads. Revision and ownership remain readback facts; the
 * evaluator validates only the canonical DSL state plus its optional id/name.
 */
export function timelineDslDocumentFromArtifact(value: unknown): unknown {
  const envelope = record(value);
  const state = record(envelope?.state);
  if (!envelope || !state) return value;

  return {
    ...state,
    ...(typeof envelope.id === "string" ? { id: envelope.id } : {}),
    ...(typeof envelope.name === "string" ? { name: envelope.name } : {}),
  };
}
