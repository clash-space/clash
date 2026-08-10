# Executable Plugins — Overview

Executable plugins extend Clash with runnable code: canvas actions, provider
projectors, and **provider executors** that bring third-party model gateways
into the catalog.

## What a provider plugin ships

| Artifact | apiVersion | Purpose |
| --- | --- | --- |
| Manifest | `clash.plugin/v1` | Identity, version, runtime, exports, permissions |
| Provider | `clash.provider/v1` | Provider identity + auth methods (OAuth, token import) |
| Model bindings | `clash.binding/v1` | Attach the provider to existing model cards |
| Cards (optional) | `clash.card/v1` | New models not in the built-in registry — official names only |
| Contract tests | `clash.plugin.contract-test/v1` | Gate every activation with strict request/response fixtures |
| Handler | ESM bundle | The stdio executor |

A pure gateway plugin typically exports **zero cards** and many bindings: the
models already exist as cards; the plugin only adds a new way to reach them.

## Lifecycle

```
clash action init-plugin <dir>     # scaffold a draft (~/.clash/drafts/…)
  … edit …
clash action validate <dir>        # schema check + run all contract tests
clash action activate <dir>        # validate → approve capabilities → atomic activate
```

Activation is atomic, keeps the previous version for `clash action rollback`,
and **refuses to replace executable code without a version bump**. Activated
packages live under `~/.clash/actions/<id>/` with content attestation; editing
an activated package in place makes the loader skip it until re-activated.

## Runtime model

Plugins run as separate processes speaking newline-delimited JSON over stdio:

- in: `clash.plugin.invoke/v1`
- out: `clash.plugin.result/v1`
- side-channel: `clash.plugin.broker-request/v1` for capabilities

Two entrypoint languages share that ABI:

- **Node (`.mjs`)** — `--permission` filesystem allowlist (read-only, own
  package dir) plus **all network APIs replaced with throwing stubs**
  (`fetch`, `http`, `net`, `tls`, `dgram`, `dns` →
  `ERR_CLASH_PLUGIN_NETWORK_DENIED`)
- **Python (`.py`)** — an injected `sitecustomize` replaces every socket
  constructor with the same-marker stubs; interpreter comes from the
  app-managed environments (see [Python SDK](/sdk/python-sdk)). No
  filesystem guard yet — prefer `.mjs` when you need it.

Everything a plugin needs from the outside world — credentials, network,
assets — goes through the [capability broker](/plugins/broker).
