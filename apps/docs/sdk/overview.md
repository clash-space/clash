# SDK Overview

| Package | Audience | Purpose |
| --- | --- | --- |
| [`@clash-space/sdk`](/sdk/clash-sdk) | App/tool builders (JS) | Register and run local Node.js code as canvas actions; agent client; local ASR/TTS runtime clients |
| [`clash-sdk` (Python)](/sdk/python-sdk) | App/tool builders (Python) | Same action protocol in Python; hosts the local ASR/TTS model runtimes; plain `.py` action packages |
| [`@clash-space/action-sdk`](/sdk/action-sdk) | Action & plugin authors | Types and helpers for action manifests and hosted executable plugins |
| [`@clash-space/cli`](/reference/cli) | Everyone | Terminal control of projects, canvases, plugins, timelines |
| [`@clash-space/mcp-server`](/sdk/mcp) | Agent integrators | Clash capabilities over the Model Context Protocol |

Supporting packages you will meet in types: `@clash/shared-types` (model
cards, plugin schemas, timeline contracts), `@clash/shared-runtime`,
`@clash-space/bridge` (plugin host IPC, actions loader).

## Which one do I want?

- **Add a model or provider to the catalog** →
  [Tutorial: Add a Model or Provider](/guide/add-model-provider) — three
  paths: bind existing cards, ship a new card in your plugin, or first-party.
- **Bring a third-party model gateway into the catalog** → executable plugin
  ([guide](/plugins/overview)) + bindings; no SDK required beyond the stdio
  contract, though `action-sdk` types help.
- **Run my own Node code as a canvas action** → `@clash-space/sdk`
  (`defineAction`, `run`).
- **Run my own Python code as a canvas action / host local models** →
  [Python SDK](/sdk/python-sdk) (`@action`, `run`, `clash_sdk.local_models`).
  Note: provider plugins themselves are Node-only today.
- **Script Clash from an agent** → MCP server, or the CLI's agent-editable
  projections (`clash timeline pull/apply`, `clash text`).
- **Transcribe/synthesize locally** → `@clash-space/sdk` local runtimes or
  `clash models`.
