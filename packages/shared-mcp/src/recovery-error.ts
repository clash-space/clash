export type ClashStaleRecovery = {
  schemaVersion: 1;
  code: "STALE_READ";
  entityKind: string;
  entityId: string;
  currentRevisionId: string;
  editedProjectionPath: string;
  latestProjectionPath: string;
  recoveryReceiptPath: string;
  next: string;
  resubmitted: false;
};

export type ParsedClashRecoveryError = {
  message: string;
  recovery?: ClashStaleRecovery;
};

const RECOVERY_MARKER = " CLASH_RECOVERY=";

export function parseClashRecoveryError(rawMessage: string): ParsedClashRecoveryError {
  const explicit = rawMessage.match(
    /(?:^|[\r\n])\s*(?:Error:\s*)?([A-Z][A-Z0-9_]+:[^\r\n]*)/,
  )?.[1]?.trim() ?? rawMessage.trim();
  const markerIndex = explicit.indexOf(RECOVERY_MARKER);
  if (markerIndex < 0) return { message: explicit };

  const message = explicit.slice(0, markerIndex).trim();
  try {
    const parsed = JSON.parse(explicit.slice(markerIndex + RECOVERY_MARKER.length));
    return isStaleRecovery(parsed)
      ? { message, recovery: parsed }
      : { message: explicit };
  } catch {
    return { message: explicit };
  }
}

function isStaleRecovery(value: unknown): value is ClashStaleRecovery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && record.code === "STALE_READ"
    && record.resubmitted === false
    && [
      "entityKind",
      "entityId",
      "currentRevisionId",
      "editedProjectionPath",
      "latestProjectionPath",
      "recoveryReceiptPath",
      "next",
    ].every((key) => typeof record[key] === "string" && (record[key] as string).length > 0);
}
