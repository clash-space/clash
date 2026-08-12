import { describe, expect, it, vi } from "vitest";

import type { LocalProviderAccountConfig } from "./provider-accounts.js";
import {
  loadProviderLiveTestConfig,
  loadProviderLiveTestLocalAccount,
} from "./provider-live-test-config.test-helper.js";

describe("provider live test config", () => {
  it("never reads the local provider store without live opt-in", async () => {
    const loadAccounts = vi.fn(async () => []);
    const config = await loadProviderLiveTestConfig({
      CLASH_PROVIDER_E2E_LOCAL_DATA_DIR: "/private/provider-data",
    });

    await expect(
      loadProviderLiveTestLocalAccount(config, {
        accountIdEnv: "CLASH_GOOGLE_ACCOUNT_ID",
        matches: () => true,
        loadAccounts,
      }),
    ).resolves.toBeUndefined();
    expect(loadAccounts).not.toHaveBeenCalled();
  });

  it("loads only the explicitly selected live account from the opted-in data dir", async () => {
    const accounts: LocalProviderAccountConfig[] = [
      {
        id: "google-sa",
        providerId: "google",
        upstreamId: "google",
        enabled: true,
        credentials: { serviceAccountKey: "private-service-account" },
      },
      {
        id: "official-primary",
        providerId: "official",
        upstreamId: "google-ai-studio",
        enabled: true,
        credentials: { apiKey: "private-api-key", service: "agent-platform" },
      },
    ];
    const loadAccounts = vi.fn(async () => accounts);
    const config = await loadProviderLiveTestConfig({
      CLASH_PROVIDER_E2E: "live",
      CLASH_PROVIDER_E2E_LOCAL_DATA_DIR: "/private/provider-data",
      CLASH_GOOGLE_ACCOUNT_ID: "official-primary",
    });

    const account = await loadProviderLiveTestLocalAccount(config, {
      accountIdEnv: "CLASH_GOOGLE_ACCOUNT_ID",
      matches: (candidate) =>
        candidate.providerId === "google" ||
        (candidate.providerId === "official" &&
          candidate.upstreamId === "google-ai-studio"),
      loadAccounts,
    });

    expect(loadAccounts).toHaveBeenCalledWith("/private/provider-data");
    expect(account).toMatchObject({
      id: "official-primary",
      credentials: { apiKey: "private-api-key", service: "agent-platform" },
    });
  });
});
