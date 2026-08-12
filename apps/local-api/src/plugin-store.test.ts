import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPluginStore, type PluginStore } from "./plugin-store";

/**
 * What a plugin keeps, without the host knowing what any of it means.
 *
 * Settings lived in fixed columns on `provider_accounts` — `region`, `label`, `api_shape`,
 * `priority`, `weight` — so anything a provider needed that was not on that list could not be
 * stored. `--location` was accepted, printed success, and dropped the value for exactly this
 * reason. Flow state was worse: `provider_oauth` has a column per OAuth flow (`device_code`,
 * `user_code`, `interval_seconds`, `oauth_state`), so a new flow meant a schema change.
 *
 * Two things the host does read: `secret`, which decides encryption at rest, and `expiresAt`, which
 * is what makes renewal schedulable. Everything else is opaque.
 */
describe("plugin store", () => {
  let store: PluginStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "clash-store-"));
    store = await openPluginStore({ dataDir: dir });
  });

  it("keeps a value under a key of the plugin's choosing", async () => {
    await store.put({ pluginId: "p", accountId: "a", key: "anything", value: "v" });
    expect(await store.get({ pluginId: "p", accountId: "a", key: "anything" })).toBe("v");
  });

  it("stores a region without a region column", async () => {
    // The setting that could not be stored, stored.
    await store.put({ pluginId: "p", accountId: "a", key: "region", value: "us-central1" });
    expect(await store.get({ pluginId: "p", accountId: "a", key: "region" })).toBe("us-central1");
  });

  it("does not let one plugin read another's value", async () => {
    // Plugins hold credentials in plaintext, so this is the boundary that remains: installing a
    // plugin exposes the accounts configured for it, not every account on the machine.
    await store.put({ pluginId: "one", accountId: "a", key: "apiKey", value: "secret-one" });
    expect(await store.get({ pluginId: "two", accountId: "a", key: "apiKey" })).toBeUndefined();
  });

  it("encrypts what is marked secret", async () => {
    await store.put({ pluginId: "p", accountId: "a", key: "apiKey", value: "sk-plain", secret: true });
    const raw = await store.rawValueForTest({ pluginId: "p", accountId: "a", key: "apiKey" });
    expect(raw).not.toContain("sk-plain");
    expect(await store.get({ pluginId: "p", accountId: "a", key: "apiKey" })).toBe("sk-plain");
  });

  it("reports what is due for renewal, and nothing else", async () => {
    const now = Date.now();
    await store.put({ pluginId: "p", accountId: "a", key: "soon", value: "x", expiresAt: now + 30_000 });
    await store.put({ pluginId: "p", accountId: "a", key: "later", value: "y", expiresAt: now + 7_200_000 });
    await store.put({ pluginId: "p", accountId: "a", key: "never", value: "z" });

    const due = await store.dueForRenewal({ within: 60_000, now });
    expect(due.map((entry) => entry.key)).toEqual(["soon"]);
  });

  it("replaces a value rather than accumulating versions", async () => {
    await store.put({ pluginId: "p", accountId: "a", key: "accessToken", value: "old" });
    await store.put({ pluginId: "p", accountId: "a", key: "accessToken", value: "new" });
    expect(await store.get({ pluginId: "p", accountId: "a", key: "accessToken" })).toBe("new");
  });

  it("forgets a value when asked", async () => {
    await store.put({ pluginId: "p", accountId: "a", key: "refreshToken", value: "r" });
    await store.remove({ pluginId: "p", accountId: "a", key: "refreshToken" });
    expect(await store.get({ pluginId: "p", accountId: "a", key: "refreshToken" })).toBeUndefined();
  });
});

/**
 * A plugin cannot name itself.
 *
 * `(pluginId, accountId, key)` is the host's own addressing. If a plugin could supply the first
 * component it could read any other plugin's credentials by asking for them, and the scoping above
 * would be a naming convention rather than a boundary.
 *
 * So the plugin never sends a pluginId. The host spawned the process and knows which plugin it is;
 * it hands out a handle already bound to that identity, and the handle takes a key and nothing more.
 * This is how the existing broker already works -- it reads `context.manifest.id` from the spawn
 * context and refuses a credential handle whose `pluginId` does not match.
 */
describe("plugin identity is not self-declared", () => {
  let store: PluginStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "clash-store-id-"));
    store = await openPluginStore({ dataDir: dir });
  });

  it("gives a plugin a handle bound to it, taking only a key", async () => {
    const bound = store.forPlugin({ pluginId: "one", accountId: "a" });
    await bound.put("apiKey", "mine");
    expect(await bound.get("apiKey")).toBe("mine");
  });

  it("cannot reach another plugin's value through its own handle", async () => {
    await store.put({ pluginId: "two", accountId: "a", key: "apiKey", value: "theirs" });
    const bound = store.forPlugin({ pluginId: "one", accountId: "a" });
    expect(await bound.get("apiKey")).toBeUndefined();
  });

  it("cannot escape its scope through the key", async () => {
    // The key is data, not a path. A separator in it must not address another plugin's row.
    await store.put({ pluginId: "two", accountId: "a", key: "apiKey", value: "theirs" });
    const bound = store.forPlugin({ pluginId: "one", accountId: "a" });
    expect(await bound.get("two/a/apiKey")).toBeUndefined();
    expect(await bound.get("../two/apiKey")).toBeUndefined();
  });

  it("cannot reach another account of its own", async () => {
    // Accounts are separate credentials for the same plugin; one being compromised upstream should
    // not expose the other.
    await store.put({ pluginId: "one", accountId: "b", key: "apiKey", value: "other-account" });
    const bound = store.forPlugin({ pluginId: "one", accountId: "a" });
    expect(await bound.get("apiKey")).toBeUndefined();
  });
});
