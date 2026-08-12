import { describe, expect, it } from "vitest";

import { ExecutablePluginBrokerOperationSchema } from "@clash/shared-types";

/**
 * A plugin reads its own credentials out of the store.
 *
 * The host does not know what a vendor's auth looks like and should not learn. Google wants an api
 * key on one surface and a bearer token on another; MiniMax wants a key and a region; kling wants
 * an access key and a secret. Enumerating those here would mean editing the host every time a
 * vendor changes its mind.
 *
 * So the host stores opaque values and hands them back by key. The plugin knows which keys it
 * wrote, because it wrote them.
 *
 * The binding is not in the request. A plugin cannot ask for another plugin's key, or another
 * account's, because the identity comes from the spawn -- not from a field it could fill in.
 */
describe("store.get", () => {
  it("takes a key and nothing else", () => {
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "store.get",
      key: "apiKey",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a request that names a plugin", () => {
    // Naming one would make the binding forgeable: any plugin could read any other's credentials by
    // asking nicely.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "store.get",
      key: "apiKey",
      pluginId: "clash.minimax",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a request that names an account", () => {
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "store.get",
      key: "apiKey",
      accountId: "someone-else",
    });
    expect(parsed.success).toBe(false);
  });

  it("carries a key a plugin may write back", () => {
    // Renewal is the plugin's code: it refreshes a token and writes it where it found the old one.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "store.put",
      key: "accessToken",
      value: "ya29...",
      secret: true,
      expiresAt: "2026-08-11T17:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });
});
