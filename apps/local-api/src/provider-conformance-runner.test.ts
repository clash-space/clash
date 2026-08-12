import { describe, expect, it } from "vitest";

import {
  findProviderConformanceAccount,
  selectProviderConformanceStubs,
  selectProviderConformanceStubsForAccounts,
  type ProviderConformanceAccountRow,
} from "./provider-conformance-runner.js";
import { createProviderConformanceStubs } from "./provider-test-recorder.js";

describe("provider conformance runner", () => {
  it("selects targets by exact stub id or unique model id", () => {
    const stubs = createProviderConformanceStubs();

    expect(selectProviderConformanceStubs(stubs, [
      "official:google-ai-studio:global:gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ]).map((stub) => stub.id)).toEqual([
      "official:google-ai-studio:global:gemini-3.5-flash",
      "official:google-ai-studio:global:gemini-3.1-flash-lite",
    ]);
  });

  it("rejects ambiguous model-only target selectors", () => {
    const stubs = createProviderConformanceStubs();

    expect(() => selectProviderConformanceStubs(stubs, ["nano-banana-2"]))
      .toThrow(/Ambiguous provider conformance target/);
  });

  it("matches configured provider accounts by provider, upstream, region, and user", () => {
    const stub = createProviderConformanceStubs()
      .find((candidate) => candidate.id === "official:google-ai-studio:global:gemini-3.5-flash");
    expect(stub).toBeTruthy();
    const account: ProviderConformanceAccountRow = {
      id: "account-1",
      userId: "local-user",
      providerId: "official",
      upstreamId: "google-ai-studio",
      region: "global",
      enabled: true,
    };

    expect(findProviderConformanceAccount([{
      ...account,
      userId: "someone-else",
    }, account], stub!, "local-user")).toBe(account);
    expect(findProviderConformanceAccount([{
      ...account,
      upstreamId: "minimax",
    }], stub!, "local-user")).toBeUndefined();
  });

  it("selects the default run set from configured enabled accounts", () => {
    const stubs = createProviderConformanceStubs();
    const accounts: ProviderConformanceAccountRow[] = [
      {
        userId: "local-user",
        providerId: "official",
        upstreamId: "google-ai-studio",
        region: "global",
        enabled: true,
      },
      {
        userId: "local-user",
        providerId: "replicate",
        upstreamId: "replicate",
        enabled: false,
      },
      {
        userId: "other-user",
        providerId: "fal",
        upstreamId: "fal",
        enabled: true,
      },
    ];

    const selected = selectProviderConformanceStubsForAccounts(stubs, accounts, "local-user");
    expect(selected.map((stub) => stub.id)).toContain("official:google-ai-studio:global:gemini-3.5-flash");
    expect(selected.map((stub) => stub.id)).toContain("official:google-ai-studio:global:nano-banana-pro");
    expect(selected.some((stub) => stub.providerId === "replicate")).toBe(false);
    expect(selected.some((stub) => stub.providerId === "fal")).toBe(false);
  });
});
