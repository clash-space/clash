import { describe, expect, it } from "vitest";

import { executablePluginDependencyError } from "./executable-plugin.js";

/**
 * Dependency injection checks the same thing the spawn checked: what the plugin contributes.
 *
 * Every branch here read `manifest.permissions` -- a block that no longer exists. A plugin could
 * open a socket and then be refused a place
 * to put what came back: hrhrng.hub reached its vendor, generated an image, and failed with
 * "Asset uploads require asset write permission", which describes a declaration that is gone.
 *
 * Two checks against two lists is how they drift. There is one list now, and it is `contributes`.
 */
const manifest = (functions: { id: string; kind: string }[]) => ({
  apiVersion: "clash.plugin/v1",
  id: "test.p",
  version: "0.1.0",
  name: "test",
  runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs", args: [] },
  contributes: { functions },
}) as never;

const executor = manifest([{ id: "x", kind: "provider-executor" }]);

// The function parses a whole broker request, not a bare operation: a frame has to say which
// invocation it belongs to before anyone can ask whether it is allowed.
const request = (operation: unknown) => ({
  protocol: "clash.plugin.broker-request/v1",
  requestId: "b-1",
  invocationId: "i-1",
  operation,
});
const projector = manifest([{ id: "p", kind: "provider-projector" }]);

describe("executablePluginDependencyError", () => {
  it("lets an executor open an upload slot", () => {
    expect(executablePluginDependencyError(executor, request({
      kind: "asset.upload-slot", slot: "media", assetKind: "image", byteLength: 10,
    }) as never)).toBeNull();
  });

  it("lets an executor write an asset", () => {
    expect(executablePluginDependencyError(executor, request({
      kind: "asset.write", slot: "media", assetKind: "image", dataBase64: "AA==",
    }) as never)).toBeNull();
  });

  it("refuses a projector the same operations", () => {
    // A projector maps an invocation onto a request shape. One writing assets is doing something
    // its kind does not describe, and the kind is what the host dispatches on.
    expect(executablePluginDependencyError(projector, request({
      kind: "asset.upload-slot", slot: "media", assetKind: "image", byteLength: 10,
    }) as never)).toMatch(/does not contribute/i);
  });

  it("allows only a contribution that owns account state to use the store", () => {
    expect(executablePluginDependencyError(executor, request({
      kind: "store.get", key: "apiKey",
    }) as never)).toBeNull();
    expect(executablePluginDependencyError(projector, request({
      kind: "store.get", key: "apiKey",
    }) as never)).toMatch(/does not contribute/i);
  });

  it("rejects provider networking and credential handles as non-SDK operations", () => {
    for (const operation of [
      { kind: "credential.handle", secretId: "provider:minimax" },
      { kind: "network.fetch", url: "https://api.example.test/v1", method: "POST" },
    ]) {
      expect(() => executablePluginDependencyError(executor, request(operation) as never))
        .toThrow();
    }
  });
});
