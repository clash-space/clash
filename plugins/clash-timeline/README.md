# Clash Timeline Codex plugin

This package is the installable Codex boundary for Clash Timeline. It bundles:

- a `.codex-plugin/plugin.json` manifest;
- typed `clash_timeline_*` MCP tools;
- a self-contained MCP App GUI;
- a shell-free adapter to the public `clash timeline` CLI;
- a bundled skill that routes Timeline work through this interface.

The package does not import Canvas MCP internals. It reads and writes the same
Project Timeline entities as the CLI, including the normal read-proof and YAML
projection apply behavior.

## Build and verify

```bash
pnpm test:package @clash/timeline-plugin
pnpm typecheck:package @clash/timeline-plugin
pnpm build:package @clash/timeline-plugin
```

The build produces `runtime/index.js` and `runtime/app-client.js`, which are the
files launched from `.mcp.json` after the plugin is installed.
