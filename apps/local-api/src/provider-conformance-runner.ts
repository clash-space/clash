import type { ProviderConformanceStub } from "./provider-test-recorder.js";

export interface ProviderConformanceAccountRow {
  id?: string;
  userId?: string;
  providerId: string;
  upstreamId?: string;
  region?: string;
  enabled?: boolean;
}

export function findProviderConformanceAccount(
  accounts: readonly ProviderConformanceAccountRow[],
  stub: ProviderConformanceStub,
  userId: string,
): ProviderConformanceAccountRow | undefined {
  return accounts.find((account) =>
    (account.userId ?? userId) === userId &&
    account.enabled !== false &&
    account.providerId === stub.providerId &&
    (!stub.upstreamId || !account.upstreamId || account.upstreamId === stub.upstreamId) &&
    ((account.region ?? "") === (stub.region ?? ""))
  );
}

export function selectProviderConformanceStubs(
  stubs: readonly ProviderConformanceStub[],
  selectors: readonly string[],
): ProviderConformanceStub[] {
  return selectors.map((selector) => {
    const exact = stubs.find((stub) => stub.id === selector);
    if (exact) return exact;

    const modelMatches = stubs.filter((stub) => stub.modelId === selector);
    if (modelMatches.length === 1) return modelMatches[0]!;
    if (modelMatches.length > 1) {
      throw new Error(
        `Ambiguous provider conformance target "${selector}". Use one of: ${modelMatches.map((stub) => stub.id).join(", ")}`,
      );
    }

    throw new Error(`Unknown provider conformance target: ${selector}`);
  });
}

export function selectProviderConformanceStubsForAccounts(
  stubs: readonly ProviderConformanceStub[],
  accounts: readonly ProviderConformanceAccountRow[],
  userId: string,
): ProviderConformanceStub[] {
  return stubs.filter((stub) => !!findProviderConformanceAccount(accounts, stub, userId));
}
