# Getting Started

Clash is a local-first AI video production platform. A local host process owns
your projects; the desktop app, CLI, plugin MCP, and agents all reach that same
host. CLI and plugin MCP are peer clients with the same capabilities; neither
invokes the other or owns another daemon or Project replica.

## Prerequisites

- Node.js 24.18+ (Node 24.x) and pnpm 10+
- macOS (Apple Silicon recommended; local ASR/TTS run on MLX)

## Install and build

```sh
pnpm install
make build
```

## Start the local host

Open Clash Desktop, or start the host from a checkout. The host writes a
discovery record so every tool can find it:

```sh
clash host status
# Host: active
# Endpoint: http://127.0.0.1:<port>
# Launch mode: user-service
```

Discovery lives at `~/.clash/run/host.json` (schema, endpoint, pid and
timestamps). Tools must read discovery instead of
hardcoding a port — the port is dynamic.

## Link a project directory

```sh
clash init --project <id>  # writes .clash/project.toml into the cwd
clash canvas list --json   # discovers local-api automatically
```

Project identity lives in `.clash/project.toml`. Collaborative state lives in
the Project's local-api-owned Loro CRDT replica; files in your working directory
are editable projections of it. CLI commands never open a second replica or
connect directly to the cloud ProjectRoom.

## Sanity checks

```sh
clash doctor            # local project health
clash models catalog    # composed model catalog with provider routing
clash plugin list --local
```

## Where things live

| Path                     | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `~/.clash/`              | Clash home (`CLASH_HOME` to override)                     |
| `~/.clash/run/host.json` | Host discovery record                                     |
| `~/.clash/actions/`      | Activated plugin packages (attested, content-hashed)      |
| `~/.clash/drafts/`       | Agent-editable plugin drafts                              |
| `~/.clash/local-api/`    | Host data dir: SQLite, generated assets, provider secrets |
| `~/.clash/config.yaml`   | User configuration                                        |

## Optional cloud sync

Pure local projects never require login. `clash auth login` (OAuth 2.0 + PKCE)
enables optional cloud sync; credentials land in `~/.clash/credentials.json`.
