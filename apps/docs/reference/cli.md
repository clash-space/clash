# CLI Reference

```
clash [--profile dev|prod] <command>
```

The public distribution is the unscoped `clash` package:

```sh
npm install -g clash
# or run one command without installing globally
npx -y clash --help
```

Local commands need no cloud auth. Project identity resolves from
`.clash/project.toml` in the cwd (override with `CLASH_PROJECT_ID`).

The CLI is a short-lived client of `local-api`. It discovers the active local
host and uses HTTP/WebSocket APIs; it does not own the local daemon, ACP
sessions, plugin subprocesses, persistence, or cloud replication. Commands
that configure those facilities remain control surfaces for `local-api`, not
embedded copies of its runtime.

## Commands

| Command      | Purpose                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `init`       | Write a local project marker into the cwd                                                                             |
| `projects`   | Manage projects                                                                                                       |
| `canvas`     | Canvas node operations through the discovered local-api host                                                          |
| `canvases`   | Manage Canvases inside a Project                                                                                      |
| `tasks`      | Generation task management                                                                                            |
| `plugin`     | Plugins: `create`, `checkout`, `validate`, `activate`, `install`, `list`, `uninstall`, `rollback`, `remove`, `search` |
| `models`     | Model catalog, provider routing, local audio models                                                                   |
| `host`       | `host status` — discovery record, endpoint, pid                                                                       |
| `timeline`   | Agent-editable YAML projections: `pull` / `apply` (stale writes refused)                                              |
| `text`       | Agent-editable text node files                                                                                        |
| `production` | Local production actions (asset metadata fills)                                                                       |
| `assets`     | Inspect and link project assets                                                                                       |
| `audit`      | Local mutation audit evidence                                                                                         |
| `effect`     | Timeline effects: create, validate, package, install                                                                  |
| `director`   | Director Stage scenes                                                                                                 |
| `doctor`     | Local health checks                                                                                                   |
| `auth`       | Optional cloud sync (OAuth 2.0 + PKCE)                                                                                |

## The plugin loop

```sh
clash plugin create   ~/plugins/my-gateway
clash plugin validate ~/plugins/my-gateway
clash plugin activate ~/plugins/my-gateway    # atomic; version-gated
clash plugin rollback my-gateway              # restore newest retained version
```

`validate`/`activate` emit JSON (id, version, per-contract pass/fail) — pipe
into `jq`/CI directly.

`clash mcp` starts the package's stdio MCP process. It is a peer client with
the same capabilities and reaches the same discovered `local-api` host
directly. The old `clash mcp serve` HTTP server no longer exists.

The CLI is the intended component manager for daemon and Desktop lifecycle.
npm, DMG, daemon-only, and Homebrew bootstraps use the same installer protocol,
signed release manifest, `~/.clash/components` registry, content-addressed
runtime store, and singleton daemon. Install/update/uninstall commands are
added only alongside real, verified release artifacts and atomic activation;
there is currently no placeholder `clash install desktop` command.

## Environment

See [Environment Variables](/reference/environment) for the full table
(`CLASH_HOME`, `CLASH_API_URL`, recording/replay paths, credential TTL, …).
