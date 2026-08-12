import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ipc = readFileSync(join(__dirname, "plugin-host-ipc.ts"), "utf8");
const loader = readFileSync(join(__dirname, "actions-loader.ts"), "utf8");

/**
 * A capability the host calls must exist at every layer, not only in the type that declares it.
 *
 * `listFunctionExports` was added to the client interface as an optional method and implemented
 * nowhere. Optional chaining then made every call return undefined, and the guard that reads it --
 * "did this plugin declare that it can be polled?" -- answered no for every plugin. Acceptances
 * failed closed, which is the safe direction and a broken one: a real generation was submitted to a
 * real provider and then refused by our own host.
 *
 * The same shape of defect appeared earlier with listProviders and listModelBindings, which existed
 * only inside a compiled bundle. A method that exists only in a type is not a method.
 */
describe("function export listing exists end to end", () => {
  it("is carried by the wire protocol", () => {
    expect(ipc).toMatch(/operation:\s*"list-function-exports"/);
  });

  it("is answered by the host", () => {
    expect(ipc).toMatch(/host\.listFunctionExports\?\.\(/);
  });

  it("is callable from the client", () => {
    expect(ipc).toMatch(/async listFunctionExports\(/);
  });

  it("is actually implemented, not merely declared", () => {
    // The layer that ends the chain. Without it the other three are a protocol for asking a
    // question no one answers.
    expect(loader).toMatch(/listFunctionExports\(pluginId: string\): ExecutablePluginFunctionExport\[\]/);
  });
});
