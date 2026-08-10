# CLI Reference

```
clash [--profile dev|prod] <command>
```

Local commands need no cloud auth. Project identity resolves from
`.clash/project.toml` in the cwd (override with `CLASH_PROJECT_ID`).

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Write a local project marker into the cwd |
| `projects` | Manage projects |
| `canvas` | Canvas node operations (Loro CRDT sync); `canvas connect` keeps a replica attached |
| `canvases` | Manage Canvases inside a Project |
| `tasks` | Generation task management |
| `action` | Executable plugins: `init-plugin`, `checkout`, `validate`, `activate`, `install`, `list`, `uninstall`, `rollback`, `remove`, `search` |
| `models` | Model catalog, provider routing, local audio models |
| `host` | `host status` — discovery record, endpoint, pid |
| `timeline` | Agent-editable YAML projections: `pull` / `apply` (stale writes refused) |
| `text` | Agent-editable text node files |
| `production` | Local production actions (asset metadata fills) |
| `assets` | Inspect and link project assets |
| `audit` | Local mutation audit evidence |
| `mcp` | `mcp serve` — MCP over Streamable HTTP |
| `effect` | Timeline effects: create, validate, package, install |
| `director` | Director Stage scenes |
| `doctor` | Local health checks |
| `auth` | Optional cloud sync (OAuth 2.0 + PKCE) |

## The plugin loop

```sh
clash action init-plugin ~/.clash/drafts/my-gateway
clash action validate   ~/.clash/drafts/my-gateway
clash action activate   ~/.clash/drafts/my-gateway    # atomic; version-gated
clash action rollback   my-gateway                    # restore newest retained version
```

`validate`/`activate` emit JSON (id, version, per-contract pass/fail) — pipe
into `jq`/CI directly.

## Environment

See [Environment Variables](/reference/environment) for the full table
(`CLASH_HOME`, `CLASH_API_URL`, recording/replay paths, credential TTL, …).
