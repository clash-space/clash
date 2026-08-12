import { describe, expect, it } from "vitest";

import { pluginCapabilities } from "./plugin-capabilities.js";

/**
 * What a plugin contributes decides what it can reach. There is no separate permission list.
 *
 * The manifest used to carry `permissions` -- network domains, `assets: ["read","write"]`,
 * `secrets`, `hostTools` -- kept in step with the exports by hand. It went wrong in both directions
 * on one plugin in one day: hrhrng.hub declared `secrets: ["provider:hilo-hub"]` long after it had
 * stopped using that primitive, and once that stale entry was removed its executor could not reach
 * the network, because the domains had been written for a shape it no longer had.
 *
 * A capability list beside a contributions list is the same fact written twice, and the copy that
 * is wrong is the one nobody reads. An executor exists to call a vendor, so it gets the network and
 * a store; a projector is arithmetic on an invocation, so it gets neither; an action performs
 * something the plugin brought itself, so it gets the host's asset surface.
 *
 * This is not a security boundary and does not pretend to be one. The plugin sandbox was removed
 * deliberately -- a plugin is a subprocess that can already read any file and open any socket its
 * user can. What this removes is the ceremony of declaring twice, and the class of failure where
 * the two disagree.
 */
describe("pluginCapabilities", () => {
  it("gives an executor the network and a store", () => {
    const capabilities = pluginCapabilities({
      functions: [{ id: "x-execute", kind: "provider-executor" }],
    });
    expect(capabilities.network).toBe(true);
    expect(capabilities.store).toBe(true);
    expect(capabilities.assets).toBe(true);
  });

  it("gives a projector nothing to reach for", () => {
    // A projector maps an invocation onto a vendor's request shape. It has no reason to open a
    // socket, and one that does is doing something its kind does not describe.
    const capabilities = pluginCapabilities({
      functions: [{ id: "x-project", kind: "provider-projector" }],
    });
    expect(capabilities.network).toBe(false);
    expect(capabilities.store).toBe(false);
    expect(capabilities.assets).toBe(false);
  });

  it("gives an action the asset surface", () => {
    // An action produces something -- a rendered timeline, a file. It needs somewhere to put it.
    const capabilities = pluginCapabilities({ functions: [{ id: "render", kind: "action" }] });
    expect(capabilities.assets).toBe(true);
  });

  it("takes the union when a plugin contributes several kinds", () => {
    // clash.media contributed projectors and executors together. The narrower kind must not veto
    // what the wider one needs.
    const capabilities = pluginCapabilities({ functions: [
      { id: "x-project", kind: "provider-projector" },
      { id: "x-execute", kind: "provider-executor" },
    ] });
    expect(capabilities.network).toBe(true);
  });

  it("gives a plugin contributing nothing no capabilities at all", () => {
    expect(pluginCapabilities({ functions: [] }))
      .toEqual({ network: false, store: false, assets: false, hostTools: [] });
  });

  it("grants nothing for a kind it does not know", () => {
    // Caught by mutation: defaulting an unrecognised kind to full access passed every other case.
    // A kind this host cannot dispatch is a plugin declaring something it cannot honour, and the
    // safe reading of "I do not know what this is" is not "so it may do anything".
    expect(pluginCapabilities({ functions: [{ id: "x", kind: "some-future-kind" }] }))
      .toEqual({ network: false, store: false, assets: false, hostTools: [] });
  });
});

/**
 * A named host tool is not a capability class.
 *
 * `network`, `store` and `assets` follow from the kind of an entry point: an executor exists to
 * call a vendor, so it gets a socket. `codex.imagegen` follows from nothing -- it is one specific
 * generator this host provides, and inferring it from `kind: "action"` would hand it to every
 * action ever written, including the ones that have never heard of it.
 *
 * So it stays declared. What changed is where: it is a contribution, in the block that says what
 * the plugin hooks into, rather than in a `permissions` list maintained separately from it. That
 * separation is what went stale on hrhrng.hub in both directions in one day.
 */
describe("host tools", () => {
  it("grants a host tool the plugin contributes", () => {
    expect(pluginCapabilities({
      functions: [{ id: "generate", kind: "action" }],
      hostTools: ["codex.imagegen"],
    }).hostTools).toEqual(["codex.imagegen"]);
  });

  it("gives an ordinary action no host tools at all", () => {
    // The regression this pins: dropping the dimension meant every action implicitly had every
    // host tool, or none did. clash.codex-imagegen is real and installed, and it broke.
    expect(pluginCapabilities({ functions: [{ id: "generate", kind: "action" }] }).hostTools)
      .toEqual([]);
  });

  it("does not treat legacy permissions as contributions", () => {
    expect(pluginCapabilities({
      functions: [{ id: "generate", kind: "action" }],
      permissions: { hostTools: ["codex.imagegen"] },
    } as never).hostTools).toEqual([]);
  });
});
