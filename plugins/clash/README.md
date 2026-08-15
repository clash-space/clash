# Clash

One headless npm package for the complete local Clash workspace:

- `clash <command>` runs the CLI client;
- `clash mcp` runs the peer stdio MCP client;
- the packaged `local-api` host is an internal runtime, started on demand.

Install it globally with `npm install -g clash`, or configure an MCP client to
run `npx -y clash mcp`.

## Runtime model

The package contains the CLI, MCP tools, skills, bundled GUI resources,
`local-api`, Loro WASM, agent templates, and the exact immutable payloads for
its first-party plugins. The Host imports those trusted modules in-process from
a closed registry; it does not copy them into `~/.clash/actions`, create
activation receipts for them, or launch them as child processes. Explicitly
activated third-party plugins remain isolated process/stdio packages under the
actions directory, and cannot shadow a reserved first-party id. The source stays
split across internal workspace modules; those modules are not separate user installs.
Clash Desktop is optional and carries the same host runtime for standalone
installation. A daemon-only installer may also carry that host artifact for
service deployments; it is a packaging mode of the same implementation and
data model, not another local-api product or replica.

The stable packaged layout is declared by `package.json#clashRuntime`.
Desktop copies that runtime tree unchanged and resolves `localApi`, `cli`, and
`agents` from the manifest instead of compiling a second daemon entry.
Daemon-only release tooling consumes the same `localApi` artifact.

The `clash` distribution is also the canonical component-management surface.
npm, Desktop installers, daemon-only archives, and Homebrew are bootstrap
acquisition channels, not separate runtime managers. They share one installer
core, signed release manifest, `~/.clash/components` registry,
content-addressed runtime store, and singleton service lifecycle. A future
`clash install desktop` command is intentionally not exposed until a real
downloadable, verified, atomically activated Desktop artifact exists.

On first product operation, the package reuses an active Desktop or standalone
`local-api` host when one is already published through
`~/.clash/run/host.json`. Otherwise it starts its bundled host against the same
`~/.clash/local-api` data directory. The CLI, MCP process, and Desktop do not
stop that shared daemon when they exit.

CLI and MCP are peer clients of the active host. Both preserve the same
local-api validation, read-proof, CAS, and copy-on-write behavior. There is one
local replica and one compatible host per `CLASH_HOME` and profile, not a
package- or Desktop-specific project database.

## GUI model

The package's MCP runtime contains several focused MCP Apps:

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
pnpm test:package clash
pnpm typecheck:package clash
pnpm build:package clash
```
