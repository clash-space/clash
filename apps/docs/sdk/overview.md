# SDK Overview

| Package                                 | Audience                   | Purpose                                                                                             |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@clash/sdk`](/sdk/clash-sdk)          | App/tool builders (JS)     | Register and run local Node.js code as canvas actions; agent client; local ASR/TTS runtime clients  |
| [`clash-sdk` (Python)](/sdk/python-sdk) | App/tool builders (Python) | Same action protocol in Python; hosts the local ASR/TTS model runtimes; plain `.py` action packages |
| [`@clash/action-sdk`](/sdk/action-sdk)  | Action & plugin authors    | Types and helpers for action manifests and hosted executable plugins                                |
| [`@clash/cli`](/reference/cli)          | Everyone                   | Terminal control of projects, canvases, plugins, timelines                                          |
| [Clash plugin MCP](/sdk/mcp)            | Agent clients              | Typed peer to the CLI with the same capabilities over the same local-api host                       |

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
- **Run my own Node code as a canvas action** → `@clash/sdk`
  (`defineAction`, `run`).
- **Run my own Python code as a canvas action / host local models** →
  [Python SDK](/sdk/python-sdk) (`@action`, `run`, `clash_sdk.local_models`).
  Note: provider plugins themselves are Node-only today.
- **Script Clash from an agent** → install the Clash plugin MCP, or use the CLI's agent-editable
  projections (`clash timeline pull/apply`, `clash text`).
- **Transcribe/synthesize locally** → `@clash/sdk` local runtimes or
  `clash models`.
