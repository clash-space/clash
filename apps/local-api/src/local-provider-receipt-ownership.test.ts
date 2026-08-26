import { describe, expect, it } from "vitest";

import {
  expectedProviderReceiptOwner,
  type FrozenReceiptOwnershipInput,
} from "./local-provider-receipt-ownership.js";

const executorBinding = {
  pluginId: "clash.some-provider",
  version: "1.2.0",
  exportId: "some-provider-execute",
  schemaHash: `sha256:${"c".repeat(64)}`,
};

function genericActionFrozen(
  modelRoute: Record<string, unknown>,
): FrozenReceiptOwnershipInput {
  return {
    targetKind: "generator-action",
    binding: {
      pluginId: "clash.video-enhance",
      version: "0.1.0",
      exportId: "enhance",
    },
    input: { values: { modelRoute } },
  };
}

describe("expectedProviderReceiptOwner", () => {
  it("trusts the frozen executorBinding directly, without a fresh Host resolution", async () => {
    let resolverCalls = 0;
    const owner = await expectedProviderReceiptOwner({
      frozen: genericActionFrozen({
        upstreamId: "u",
        upstreamModel: "m",
        apiShape: "s",
        accountId: "account-1",
        executorPluginId: executorBinding.pluginId,
        executorExportId: executorBinding.exportId,
        executorBinding,
      }),
      resolveProviderExecutorBinding: async () => {
        resolverCalls += 1;
        throw new Error("must not be called when executorBinding is frozen");
      },
    });
    expect(resolverCalls).toBe(0);
    expect(owner).toEqual({
      pluginId: executorBinding.pluginId,
      pluginVersion: executorBinding.version,
      accountId: "account-1",
    });
  });

  it("falls back to a fresh resolver only for a legacy route with no frozen executorBinding", async () => {
    const owner = await expectedProviderReceiptOwner({
      frozen: genericActionFrozen({
        upstreamId: "u",
        upstreamModel: "m",
        apiShape: "s",
        executorPluginId: executorBinding.pluginId,
        executorExportId: executorBinding.exportId,
      }),
      resolveProviderExecutorBinding: async (pluginId, exportId) => ({
        pluginId,
        exportId,
        version: "9.9.9",
        schemaHash: `sha256:${"e".repeat(64)}`,
      }),
    });
    expect(owner).toEqual({ pluginId: executorBinding.pluginId, pluginVersion: "9.9.9" });
  });

  it("does not delegate ownership for a plain (non-model-consumer) durable run", async () => {
    const owner = await expectedProviderReceiptOwner({
      frozen: {
        targetKind: "provider-executor",
        binding: { pluginId: "clash.some-provider", version: "1.2.0", exportId: "x" },
        input: { values: {} },
      },
    });
    expect(owner).toEqual({ pluginId: "clash.some-provider", pluginVersion: "1.2.0" });
  });

  it("is a pure lookup a caller can use to reject a wrong-plugin, wrong-version, or wrong-account receipt", async () => {
    const owner = await expectedProviderReceiptOwner({
      frozen: genericActionFrozen({
        upstreamId: "u",
        upstreamModel: "m",
        apiShape: "s",
        accountId: "account-1",
        executorPluginId: executorBinding.pluginId,
        executorExportId: executorBinding.exportId,
        executorBinding,
      }),
    });

    const matches = (staged: {
      pluginId: string;
      pluginVersion: string;
      accountId?: string;
    }) =>
      staged.pluginId === owner.pluginId &&
      staged.pluginVersion === owner.pluginVersion &&
      (owner.accountId === undefined || staged.accountId === owner.accountId);

    expect(
      matches({ pluginId: executorBinding.pluginId, pluginVersion: executorBinding.version, accountId: "account-1" }),
    ).toBe(true);
    // Wrong plugin (a different, entirely plausible Provider executor).
    expect(
      matches({ pluginId: "clash.a-different-provider", pluginVersion: executorBinding.version, accountId: "account-1" }),
    ).toBe(false);
    // Wrong version (an upgraded install of the same plugin).
    expect(
      matches({ pluginId: executorBinding.pluginId, pluginVersion: "1.3.0", accountId: "account-1" }),
    ).toBe(false);
    // Wrong account (the right plugin/version, charged to a different Provider account).
    expect(
      matches({ pluginId: executorBinding.pluginId, pluginVersion: executorBinding.version, accountId: "account-2" }),
    ).toBe(false);
  });
});
