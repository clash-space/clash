import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPluginStore } from "./plugin-store.js";

/**
 * Two accounts of one Provider must not read each other's credentials.
 *
 * One subprocess is spawned per manifest, not per account -- `actions-loader` scans the actions
 * directory and starts one process for each. So a Provider with two accounts has both flowing
 * through the same process, and if the store binding were fixed at spawn time they would share one
 * set of keys: the second account's token would overwrite the first, and every generation would run
 * as whichever connected last.
 *
 * This matters more here than it would elsewhere because accounts are ordered and fall back: when
 * the first account fails, the next answers. A binding that collapsed them would make the fallback
 * retry the same credential that just failed and report the same error twice.
 */
describe("plugin store", () => {
  it("keeps each account's values apart", async () => {
    const store = await openPluginStore({ dataDir: mkdtempSync(join(tmpdir(), "store-")) });
    await store.put({ pluginId: "clash.google", accountId: "acct-work", key: "apiKey", value: "work-key", secret: true });
    await store.put({ pluginId: "clash.google", accountId: "acct-personal", key: "apiKey", value: "personal-key", secret: true });

    expect(await store.get({ pluginId: "clash.google", accountId: "acct-work", key: "apiKey" }))
      .toBe("work-key");
    expect(await store.get({ pluginId: "clash.google", accountId: "acct-personal", key: "apiKey" }))
      .toBe("personal-key");
  });

  it("keeps each plugin's values apart under the same account id", async () => {
    // Account ids are issued per provider, so two Providers can hold the same one. Keying on the
    // account alone would let a plugin read a credential issued to another vendor entirely.
    const store = await openPluginStore({ dataDir: mkdtempSync(join(tmpdir(), "store-")) });
    await store.put({ pluginId: "clash.google", accountId: "acct-1", key: "apiKey", value: "google-key", secret: true });
    await store.put({ pluginId: "clash.minimax", accountId: "acct-1", key: "apiKey", value: "minimax-key", secret: true });

    expect(await store.get({ pluginId: "clash.google", accountId: "acct-1", key: "apiKey" }))
      .toBe("google-key");
    expect(await store.get({ pluginId: "clash.minimax", accountId: "acct-1", key: "apiKey" }))
      .toBe("minimax-key");
  });

  it("returns nothing for an account that stored nothing", async () => {
    // Missing stays missing, never "". An empty credential reaches the vendor and comes back as an
    // auth error naming the key rather than its absence.
    const store = await openPluginStore({ dataDir: mkdtempSync(join(tmpdir(), "store-")) });
    await store.put({ pluginId: "clash.google", accountId: "acct-1", key: "apiKey", value: "k", secret: true });

    expect(await store.get({ pluginId: "clash.google", accountId: "acct-2", key: "apiKey" }))
      .toBeUndefined();
  });
});
