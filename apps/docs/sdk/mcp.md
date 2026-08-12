# MCP

The installable `clash` npm package owns the supported stdio MCP entry point.
Configure an MCP client to run the same package users install for the CLI:

```json
{
  "mcpServers": {
    "clash": {
      "command": "npx",
      "args": ["-y", "clash", "mcp"]
    }
  }
}
```

The package's bundled Codex plugin config enters the same dispatcher locally.
`clash mcp serve` and the standalone Streamable HTTP server are retired.

MCP and CLI are peer clients that expose the same product capabilities and
semantics. An agent can choose either surface. Both call the discovered
`local-api` host directly; neither invokes the other or owns a Project replica,
persistence, plugin processes, or cloud replication:

```text
clash mcp ─┐
           ├─> local-api
clash CLI ─┘
```

## Canvas tool surface

Registered under server name `clash`:

| Tool                                                              | Purpose                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `clash_canvas_list` / `clash_canvas_edges`                        | Enumerate nodes and edges                             |
| `clash_canvas_get` / `clash_canvas_search`                        | Inspect nodes                                         |
| `clash_canvas_add`                                                | Add nodes (generation nodes, assets, text)            |
| `clash_canvas_execute`                                            | Run a node's generation task                          |
| `clash_canvas_update` / `clash_canvas_move` / `clash_canvas_copy` | Mutate layout and content                             |
| `clash_canvas_replace_asset`                                      | Swap a node's asset                                   |
| `clash_canvas_delete_plan` / `_delete_batch` / `_delete`          | Safe deletes (plan first)                             |
| `clash_canvas_open` / `clash_canvas_snapshot`                     | MCP App surfaces (only when app surfaces are enabled) |

Tools carry MCP annotations and UI metadata; `open`/`snapshot` bind to the
bundled Canvas MCP App resource and are skipped when `appSurfaces` is off.

## Implementation boundary

```ts
import { registerClashCanvasMcp } from "@clash/mcp-server";

registerClashCanvasMcp(server, runner, bundledAppJs, bundledStudioAppJs, {
  appSurfaces: true,
});
```

`@clash/mcp-server` is an internal typed capability surface used by the bundled
plugin, not a second deployable daemon. Its host client calls `local-api`
directly and results normalize to agent-friendly text rather than raw JSON
blobs. CLI and MCP bindings are checked against the same capability catalog;
all business behavior and state authority remain in `local-api`.

## Agent-editable projections (CLI-side alternative)

For file-oriented agents, the CLI offers the same underlying capabilities
without MCP:
`clash timeline pull/apply` (YAML projections with stale-write refusal),
`clash text` (text node files), `clash director` (stage scenes). Both roads
end in the same Loro-backed project state.
