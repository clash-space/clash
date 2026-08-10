# MCP Server

`@clash-space/mcp-server` exposes Clash Canvas to any MCP-capable agent, and
the CLI can serve it directly:

```sh
clash mcp serve        # Streamable HTTP MCP server
```

## Canvas tool surface

Registered under server name `clash`:

| Tool | Purpose |
| --- | --- |
| `clash_canvas_list` / `clash_canvas_edges` | Enumerate nodes and edges |
| `clash_canvas_get` / `clash_canvas_search` | Inspect nodes |
| `clash_canvas_add` | Add nodes (generation nodes, assets, text) |
| `clash_canvas_execute` | Run a node's generation task |
| `clash_canvas_update` / `clash_canvas_move` / `clash_canvas_copy` | Mutate layout and content |
| `clash_canvas_replace_asset` | Swap a node's asset |
| `clash_canvas_delete_plan` / `_delete_batch` / `_delete` | Safe deletes (plan first) |
| `clash_canvas_open` / `clash_canvas_snapshot` | MCP App surfaces (only when app surfaces are enabled) |

Tools carry MCP annotations and UI metadata; `open`/`snapshot` bind to the
bundled Canvas MCP App resource and are skipped when `appSurfaces` is off.

## Embedding

```ts
import { registerClashCanvasMcp } from "@clash-space/mcp-server";

registerClashCanvasMcp(server, runner, bundledAppJs, bundledStudioAppJs, {
  appSurfaces: true,
});
```

`runner` adapts tool calls onto the Clash CLI/host; results normalize to
agent-friendly text (e.g. snapshot refresh confirmations) rather than raw
JSON blobs.

## Agent-editable projections (CLI-side alternative)

For file-oriented agents, the CLI offers the same power without MCP:
`clash timeline pull/apply` (YAML projections with stale-write refusal),
`clash text` (text node files), `clash director` (stage scenes). Both roads
end in the same Loro-backed project state.
