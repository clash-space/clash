---
name: clash
description: Operate a local Clash creative workspace through the installed Clash Codex Plugin, including projects, Canvas, Timeline, Director, assets, models, tasks, text, and production.
---

# Clash

Use the bundled `clash_*` tools when the user asks to inspect or change a Clash
project. The plugin is a client of an already running Clash host; it does not own
project state. It may own the lifecycle of the bundled local-api process it
starts, but never owns a separate project store.

## Runtime boundary

- The plugin automatically reuses an active Desktop/standalone local-api host.
  If none exists, its first product tool call starts the bundled local-api.
- The host discovery record publishes the host-owned agent CLI shim used by this
  plugin. Do not fall back to an arbitrary shell command or fabricate empty
  project state.
- The plugin may close only a host whose launch mode, starter, and owner client
  id prove that this MCP process started it. Never stop Desktop, a user service,
  or another plugin process's host.
- Concurrent plugin processes coordinate startup through the shared run
  directory so that only one local host is created.
- Pass the absolute current workspace `cwd` whenever the task is scoped by a
  `.clash/project.toml` marker.

## Tools and Apps

1. Use `clash_studio_open` for the real host/project overview GUI.
2. Use typed `clash_canvas_*` tools for Canvas work and `clash_canvas_open` for
   the direct-manipulation Canvas App.
3. Use typed `clash_timeline_*` tools for Timeline work and
   `clash_timeline_open` for the Timeline App.
4. Use typed `clash_director_*` tools for Director Stage work and
   `clash_director_open` for the Director App.
5. Use exact-argv `clash_cli_*` namespace tools for project, asset, model, task,
   action, text, production, audit, auth, doctor, and effect operations that do
   not yet have a typed tool. Include `--json` when supported.
6. `clash_cli_mcp` is intentionally unavailable to prevent recursive server
   launch.

The Studio, Canvas, Timeline, and Director interfaces are separate focused MCP
Apps inside one plugin. Do not iframe the Desktop application or add GUI controls
that are not backed by a real tool call.

## Mutation rules

- Read the target entity before changing, replacing, deleting, or applying it.
- Preserve the CLI/local-api read-proof, CAS, immutability, and copy-on-write
  behavior. Never add a force bypass.
- Use graph-aware deletion planning before destructive Canvas changes.
- Keep media assets and applied revisions immutable; create a new revision or
  copy when the product contract requires it.
