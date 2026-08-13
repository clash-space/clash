# SDK Overview

| Package                                 | Audience                   | Purpose                                                                                             |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@clash/sdk`](/sdk/clash-sdk)          | Local-runtime integrators  | Typed clients for the app-managed local ASR/TTS runtimes                                             |
| [`clash-sdk` (Python)](/sdk/python-sdk) | Python plugin authors      | `clash.plugin/v1` stdio helper plus local ASR/TTS model runtimes                                     |
| [`@clash/action-sdk`](/sdk/action-sdk)  | Action & plugin authors    | Canonical types and helpers for executable plugins and Host-injected dependencies                     |
| [`@clash/cli`](/reference/cli)          | Everyone                   | Terminal control of projects, canvases, plugins, timelines                                          |
| [Clash plugin MCP](/sdk/mcp)            | Agent clients              | Typed peer for shared Project operations over the same local-api host                               |

Supporting packages you will meet in types are `@clash/shared-types` (model
cards, plugin schemas, timeline contracts) and `@clash/shared-runtime`.
The long-lived ACP runtime, plugin host IPC, and action process supervision
belong to `local-api`; `@clash/cli` is their terminal protocol client.

## Which one do I want?

- **Add a model or provider to the catalog** →
  [Tutorial: Add a Model or Provider](/guide/add-model-provider) — three
  paths: bind existing cards, ship a new card in your plugin, or first-party.
- **Bring a third-party model gateway into the catalog** → executable plugin
  ([guide](/plugins/overview)) + bindings; no SDK required beyond the stdio
  contract, though `action-sdk` types help.
- **Run my own Node code as a canvas action or provider** →
  executable plugin + [`@clash/action-sdk`](/sdk/action-sdk).
- **Run my own Python code as a canvas action or provider** →
  executable plugin + [Python SDK](/sdk/python-sdk) (`serve`).
- **Script Clash from an agent** → install the Clash plugin MCP, or use the CLI's agent-editable
  projections (`clash timeline pull/apply`, `clash text`).
- **Transcribe/synthesize locally** → `@clash/sdk` local runtimes or
  `clash models`.
