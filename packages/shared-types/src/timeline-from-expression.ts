export type FromExpression =
  | { kind: "absolute"; value: number }
  | { kind: "reference"; refId: string; offset: number };

// Try the terminal offset form before a bare id so clip-A-15 resolves to
// item clip-A with an overlap of 15 frames rather than an id ending in -15.
const OFFSET_RE = /^(.+?)\s*([+-])\s*([0-9]+(?:\.[0-9]+)?)$/;
const BARE_ID_RE = /^[A-Za-z0-9_.:-]+$/;

/** Parse the one canonical agent-facing Timeline start expression grammar. */
export function parseFromExpression(raw: unknown): FromExpression | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { kind: "absolute", value: Math.max(0, raw) };
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "start") return { kind: "absolute", value: 0 };
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return { kind: "absolute", value: Math.max(0, numeric) };
  }
  const match = trimmed.match(OFFSET_RE);
  if (match) {
    const refId = (match[1] ?? "").trim();
    if (refId) {
      const magnitude = Number.parseFloat(match[3] ?? "0");
      const offset = Number.isFinite(magnitude)
        ? (match[2] === "-" ? -magnitude : magnitude)
        : 0;
      return { kind: "reference", refId, offset };
    }
  }
  if (BARE_ID_RE.test(trimmed)) {
    return { kind: "reference", refId: trimmed, offset: 0 };
  }
  return null;
}
