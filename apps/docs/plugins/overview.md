# Executable Plugins — Overview

Executable plugins extend Clash with runnable actions, provider projectors,
and provider executors. A plugin is ordinary trusted code installed by the
user. It owns its vendor protocol and performs its own HTTP, filesystem, and
process I/O.

## What a provider plugin ships

| Artifact         | apiVersion                      | Purpose                                                           |
| ---------------- | ------------------------------- | ----------------------------------------------------------------- |
| Manifest         | `clash.plugin/v1`               | Identity, version, runtime, and contributions                     |
| Provider         | `clash.provider/v1`             | Provider identity and account configuration methods               |
| Model bindings   | `clash.binding/v1`              | Attach the provider to model cards                                |
| Cards (optional) | `clash.card/v1`                 | Add models that are not already in the catalog                    |
| Contract tests   | `clash.plugin.contract-test/v1` | Exercise the real entrypoint with deterministic Host dependencies |
| Handler          | ESM bundle or Python source     | Implements the stdio invocation/result ABI                        |

A gateway normally contributes zero cards and several bindings: existing
cards describe the models, while the plugin adds another route to them.

## Lifecycle

```sh
clash plugin create <dir>
# edit the draft
clash plugin validate <dir>
clash plugin activate <dir>
```

Activation validates the package, runs its contracts, and atomically replaces
the active version. The previous version remains available to `clash plugin
rollback`. Executable changes require a version bump.

Curated packages use the same lifecycle through the Host-owned marketplace:

```sh
clash plugin install <package-id>
clash plugin list
clash plugin uninstall <plugin-id>
```

The CLI never installs a handler into a Project Loro document and never
downloads the retired Python ClashAgent package format. A Project records only
the stable plugin/action binding needed by product state; local-api owns the
active executable package and process.

## Runtime and ownership

Local plugins run as separate processes with newline-delimited JSON over
stdio:

- input: `clash.plugin.invoke/v1`
- output: `clash.plugin.result/v1`

Normal runtime APIs are available, and provider HTTP uses the language's
normal client (`globalThis.fetch` in Node, an ordinary HTTP library in
Python). Clash does not proxy vendor requests.

The Host still owns Clash-specific dependencies. Once routing selects a
provider account, the SDK context exposes dependencies already scoped to that
plugin and account:

- `context.store` for credentials and settings;
- `context.reference` for typed project references;
- `context.upload` / typed outputs for project assets.

There is no plugin id or account id argument on those APIs. The Host fixes the
scope before invoking the plugin, so code cannot select another account by
forging an invocation field.

See [Manifest & Artifacts](/plugins/manifest) and [Host-scoped SDK
context](/plugins/sdk-context).
