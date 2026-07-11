export type AgentObservationResult =
  | { ok: true }
  | { ok: false; code: "READ_REQUIRED" | "STALE_READ"; error: string };

export function validateAgentObservation(options: {
  actorClientType?: string;
  operation: string;
  observedVersion?: string;
  currentVersion: string;
}): AgentObservationResult {
  if (options.actorClientType !== "agent") return { ok: true };

  const operation = options.operation.trim() || "writing";
  const observedVersion = options.observedVersion?.trim();
  if (!observedVersion) {
    return {
      ok: false,
      code: "READ_REQUIRED",
      error: `READ_REQUIRED: Read the target before ${operation}.`,
    };
  }
  if (observedVersion !== options.currentVersion) {
    return {
      ok: false,
      code: "STALE_READ",
      error: `STALE_READ: The target changed after it was read. Read it again before ${operation}.`,
    };
  }
  return { ok: true };
}
