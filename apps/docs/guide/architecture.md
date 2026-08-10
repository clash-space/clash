# Architecture

## The pieces

```
┌────────────┐   ┌────────────┐   ┌────────────┐
│  Desktop   │   │    CLI     │   │ MCP / SDKs │
└─────┬──────┘   └─────┬──────┘   └─────┬──────┘
      └───────────┬────┴────────────────┘
                  ▼
        Local host (local-api)
        • host discovery (~/.clash/run/host.json)
        • project store (Loro CRDT + SQLite)
        • model catalog composition
        • generation task runtime
        • plugin host + capability broker
                  │
      ┌───────────┼──────────────────┐
      ▼           ▼                  ▼
 Built-in     Executable         Local models
 providers    plugins (stdio,    (MLX ASR/TTS,
 (minimax,    sandboxed)         FunASR)
 fal, google, e.g. third-party
 local, …)    provider gateways
```

## Model catalog composition

The effective catalog a user sees is composed from three sources:

1. **Built-in model cards** — `MODEL_CARDS` in `@clash/shared-types`.
2. **Plugin cards** — cards exported by activated plugins.
3. **Plugin model bindings** — provider implementations exported by activated
   plugins and merged into existing cards.

Composition (`composeExecutablePluginModelCards`) merges plugin bindings into
each card's `providerImplementations`, so a third-party provider appears next
to first-party ones with the same mechanics (priority, overrides, credentials).

Provider selection per generation is routing over the composed card:
account-level model priorities, credential/OAuth availability, and
implementation `priority` decide the route. The catalog endpoint
(`GET /api/v1/models/catalog`) exposes the composed card, candidate providers,
and the selected route.

## Generation flow (plugin-backed provider)

```
UI/CLI submits task
  → host resolves route (card × provider implementation)
  → plugin host invokes the plugin's provider-executor over stdio
  → plugin asks the broker for a credential handle
  → plugin drives upstream HTTP via broker network.fetch
     (submit → poll → fetch file)
  → plugin returns outputs; host persists them as project assets
  → broker audit rows record every operation (SQLite)
```

The plugin never sees raw tokens and cannot open sockets itself — see
[Capability Broker & Security](/plugins/broker).

## Kinds

`ModelKind = 'image' | 'video' | 'audio' | 'text' | 'asr'`. ASR is a
first-class kind: the five local ASR cards sit in the same registry and route
through the same composition as image/video/audio cards, with `providerId:
"local"` implementations that run on-device (see
[Local ASR](/guide/local-asr)).
