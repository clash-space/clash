/**
 * What a plugin can reach follows from what it contributes.
 *
 * The manifest used to carry a `permissions` block -- network domains, `assets: ["read","write"]`,
 * `secrets`, `hostTools` -- maintained in step with the exports by hand. It went wrong in both
 * directions on one plugin in a single day: hrhrng.hub still declared `secrets:
 * ["provider:hilo-hub"]` long after it had stopped using that primitive, and when that stale entry
 * was removed its executor lost the network, because the domain list had been written for a shape
 * the plugin no longer had.
 *
 * A capability list beside a contributions list is one fact written twice, and the copy that goes
 * stale is the one nobody reads. Declaring an entry point *is* asking for what that entry point
 * needs: an executor exists to call a vendor, a projector is arithmetic over an invocation, an
 * action produces something and needs somewhere to put it.
 *
 * This is not a security boundary and does not pretend to be one. The plugin sandbox was removed
 * deliberately: a plugin is a subprocess that can already read any file and open any socket its
 * user can. What goes away is the ceremony of declaring twice, and the class of failure where the
 * two disagree.
 */

export interface PluginCapabilities {
  /** May open sockets, and reach the vendor it exists to call. */
  network: boolean;
  /** May read and write the credentials and settings bound to its account. */
  store: boolean;
  /** May read referenced assets and hand back new ones. */
  assets: boolean;
  /**
   * Named generators this host provides, which the plugin asked for by name.
   *
   * Not a capability class, and the one thing here that cannot follow from a kind. An executor
   * needs a socket because that is what an executor is for; nothing about `kind: "action"` implies
   * `codex.imagegen`, and inferring it would hand this host's generator to every action ever
   * written. So it stays declared -- as a contribution, beside the entry points, rather than in a
   * list maintained separately from them.
   */
  hostTools: ReadonlyArray<string>;
}

const NONE: PluginCapabilities = { network: false, store: false, assets: false, hostTools: [] };

const BY_KIND: Record<string, PluginCapabilities> = {
  // Talks to a vendor: needs the socket, the credential, and somewhere to put what comes back.
  "provider-executor": { network: true, store: true, assets: true, hostTools: [] },
  // Pure arithmetic on an invocation. A projector that opens a socket is doing something its kind
  // does not describe, and the kind is what the host dispatches on.
  "provider-projector": NONE,
  // Performs something the plugin brought itself. It produces a file; it does not necessarily call
  // anyone, but it has to be able to hand the result back.
  action: { network: true, store: true, assets: true, hostTools: [] },
};

/** Everything in the manifest's `contributes` block that affects host dependencies. */
export interface PluginContributions {
  functions?: ReadonlyArray<{ id: string; kind: string }>;
  hostTools?: ReadonlyArray<string>;
}

export function pluginCapabilities(
  contributions: PluginContributions,
): PluginCapabilities {
  // The union across contributions. A plugin that contributes both projectors and executors -- as
  // the first-party media plugin did -- must not have the narrower kind veto what the wider one
  // needs.
  const derived = (contributions.functions ?? []).reduce<PluginCapabilities>((capabilities, entry) => {
    const granted = BY_KIND[entry.kind] ?? NONE;
    return {
      network: capabilities.network || granted.network,
      store: capabilities.store || granted.store,
      assets: capabilities.assets || granted.assets,
      hostTools: [],
    };
  }, NONE);

  return {
    ...derived,
    hostTools: contributions.hostTools ?? [],
  };
}
