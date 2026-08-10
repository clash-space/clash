import { describe, expect, it } from "vitest";

import { PluginHostClient } from "./plugin-host-ipc";

/**
 * The IPC client must expose every listing the host calls.
 *
 * `local-api` asks the plugin host for providers and model bindings as well as cards:
 *
 *   pluginHostClient.listProviders()
 *   pluginHostClient.listModelBindings()
 *
 * Neither existed in this file, and the gap was hidden by a stale artefact: a previous host bundle
 * is committed inside `packages/clash-bridge/dist/agents/.../local-api.cjs`, and that copy did
 * implement both operations. Rebuilding the package from source therefore *removed* working code,
 * and the host died on its first model listing with
 *
 *   TypeError: pluginHostClient.listModelBindings is not a function
 *
 * A method that only exists in a build output is not a method.
 */
describe("plugin host client listings", () => {
  const client = new PluginHostClient({ socketPath: "/tmp/does-not-exist.sock" });

  it("offers every listing local-api depends on", () => {
    for (const method of ["listCards", "listProviders", "listModelBindings"] as const) {
      expect(typeof client[method], method).toBe("function");
    }
  });

  it("keeps resolve and invoke", () => {
    expect(typeof client.resolveBinding).toBe("function");
    expect(typeof client.invoke).toBe("function");
  });
});
