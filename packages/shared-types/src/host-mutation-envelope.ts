export type HostMutationGuardResult =
  | { ok: true }
  | { ok: false; error: string };

export type HostMutationEntity = {
  kind: string;
  id: string;
};

export type HostMutationEnvelope = {
  operation: string;
  entity: HostMutationEntity;
  actor?: unknown;
  expectedHash?: string;
  beforeHash?: string;
  expectedReadToken?: string;
  beforeReadToken?: string;
  forced: boolean;
};

export type HostMutationRecord = HostMutationEnvelope & {
  accepted: boolean;
  afterHash?: string;
  afterReadToken?: string;
  resultEntityId?: string;
  error?: string;
};

export function validateHostMutationEnvelope(options: {
  operation: string;
  entity: HostMutationEntity;
  actor?: unknown;
  expectedHash?: string | null;
  currentHash?: string | null;
  expectedReadToken?: string | null;
  currentReadToken?: string | null;
  force?: boolean;
  guard: HostMutationGuardResult;
}):
  | { ok: true; envelope: HostMutationEnvelope }
  | { ok: false; error: string; mutation: HostMutationRecord } {
  const envelope = compactEnvelope({
    operation: options.operation,
    entity: options.entity,
    actor: options.actor,
    expectedHash: options.expectedHash ?? undefined,
    beforeHash: options.currentHash ?? undefined,
    expectedReadToken: options.expectedReadToken ?? undefined,
    beforeReadToken: options.currentReadToken ?? undefined,
    forced: options.force === true,
  });
  if (!options.guard.ok) {
    return {
      ok: false,
      error: options.guard.error,
      mutation: hostMutationRejected(envelope, options.guard.error),
    };
  }
  return { ok: true, envelope };
}

export function hostMutationSucceeded(
  envelope: HostMutationEnvelope,
  options: {
    afterHash?: string | null;
    afterReadToken?: string | null;
    resultEntityId?: string | null;
  } = {},
): HostMutationRecord {
  return compactRecord({
    ...envelope,
    afterHash: options.afterHash ?? undefined,
    afterReadToken: options.afterReadToken ?? undefined,
    resultEntityId: options.resultEntityId ?? undefined,
    accepted: true,
  });
}

export function hostMutationRejected(
  envelope: HostMutationEnvelope,
  error: string,
): HostMutationRecord {
  return compactRecord({
    ...envelope,
    accepted: false,
    error,
  });
}

function compactEnvelope(envelope: HostMutationEnvelope): HostMutationEnvelope {
  return compactRecord(envelope) as HostMutationEnvelope;
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}
