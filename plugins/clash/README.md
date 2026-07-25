# Clash Codex Plugin

One installable Codex Plugin for the complete local Clash workspace.

## Runtime model

The plugin contains the MCP bridge, tools, skills, and bundled GUI resources. It
also contains a packaged `local-api`, dedicated CLI runtime, Loro WASM, and the
bundled agent templates. Clash Desktop is optional.

On first product operation, the plugin reuses an active Desktop or standalone
`local-api` host when one is already published through
`~/.clash/run/host.json`. Otherwise it starts its bundled host against the same
`~/.clash/local-api` data directory. The MCP process only stops a host whose
`plugin` ownership record matches its own client id; it never stops Desktop or
another plugin's host.

Every operation executes the active host's CLI shim with an exact argv array,
preserving the same local-api validation, read-proof, CAS, and copy-on-write
behavior used elsewhere in Clash. There is still one local replica and one host
at a time, not a plugin-specific project database.

## GUI model

One plugin contains several focused MCP Apps:

- `ui://clash/studio` — host and project overview;
- `ui://clash/canvas` — interactive node Canvas;
- `ui://clash/timeline` — Timeline editor;
- `ui://clash/director` — Director Stage editor.

Assets, models, tasks, actions, text, production, effects, audit, auth, and
diagnostics are exposed through typed or exact-argv MCP tools. New GUI surfaces
should be added only after they have a real view model and mutation contract.

The Studio App is the entry surface. Opening Canvas, Timeline, or Director does
not launch a hidden Desktop window or iframe the web app; each is an MCP App
backed by the same tools and host state.

## Development

```sh
pnpm --filter @clash-space/codex-plugin test
pnpm --filter @clash-space/codex-plugin typecheck
pnpm --filter @clash-space/codex-plugin build
```
