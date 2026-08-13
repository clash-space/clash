# Local API & Host Discovery

`local-api` is Clash's local daemon and state authority. It owns the canonical
local replica, persistence, ACP sessions, plugin processes, capability
brokering, and optional cloud connectivity. The `clash` npm package, Desktop,
and an optional daemon-only installer carry the same standalone host artifact,
discover or start one compatible machine process, and use the same data
directory. CLI and MCP are peer clients of the same Host and matching Project
operations share one semantic contract; MCP does not yet expose every CLI
surface. CLI-only lifecycle/control and working-tree projection commands do not
need MCP mirrors. The remaining MCP Project-semantic gaps are Canvas collection
management and Text Revision history/restore. Neither client invokes the other
or becomes another daemon or Project authority. Desktop exit does not stop the
shared host.

The daemon must not import CLI implementation. A CLI executable bundled by
Desktop for child agents is a packaged tool, not part of the host's source
dependency graph.

The local host serves an HTTP API on a **dynamic** localhost port. Never
hardcode ports — resolve through discovery.

## Discovery

`~/.clash/run/host.json`:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "dataSchemaVersion": 1,
  "hostId": "…",
  "endpoint": "http://127.0.0.1:<port>",
  "pid": 12345,
  "launchMode": "user-service",
  "startedBy": "plugin",
  "profile": "prod",
  "agentCliPath": "…/.clash/local-api/agent-bin/clash",
  "startedAt": "…",
  "updatedAt": "…"
}
```

The record is written after listen and removed on close; a stale record with a
dead pid must be treated as absent. `clash host status` wraps this.

There is no per-Project Canvas daemon and no `canvas connect` / `canvas
disconnect` lifecycle. The retired Project socket, pid, and `.mcp.json` files
under `~/.clash/sockets` are not discovery or client protocols. local-api may
still use one machine-local socket (or named pipe on Windows) internally for
plugin-host IPC; that endpoint is an implementation detail behind the HTTP
Project Host API.

## Selected endpoints

| Endpoint                                | Purpose                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /api/v1/models/catalog`            | Composed model catalog: card + merged provider implementations, `candidateProviders`, `selectedRoute` |
| `GET /api/v1/model-providers`           | Provider account/routing surface                                                                      |
| `GET /api/v1/local/audio/models/status` | Local ASR/TTS runtime status                                                                          |
| `GET /api/v1/local/public-storage`      | Machine public-Asset capability and secret-masked configuration                                      |
| `PATCH /api/v1/local/public-storage`    | Configure disabled, BYOS, or an available managed backend                                             |
| `POST /api/v1/local/public-storage/test`| Verify the active backend without exposing credentials                                                |

The catalog is the ground truth for "did my binding/override land" — each
entry exposes the composed card with `providerImplementations` (including
plugin-contributed ones with their `parameterOverrides` /
`defaultParamOverrides`), plus routing outcome.

## Data at rest

| Path                                            | Contents                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `~/.clash/local-api/local.sqlite`               | Resource registry, Global library, durable-run journal, provider accounts/OAuth, observations, indexes, audit |
| `~/.clash/local-api/provider-secret.key`        | At-rest encryption key for provider credentials (`enc:v1:` values)                                            |
| `~/.clash/config.yaml`                           | Machine settings, including non-secret public-storage backend fields                                          |
| `~/.clash/credentials.json`                      | Mode `0600` machine credentials, including public-storage AK/SK; never returned by settings APIs              |
| `~/.clash/assets/blobs/<sha256>/original.<ext>` | Immutable content-addressed Resource bytes shared by local Projects                                           |
| `~/.clash/cache/assets/`                        | Read-only, disposable Asset projections and derived cache                                                     |

Project Assets and Action bindings are authoritative Project Loro state, not
SQLite Asset rows. SQLite may retain migration inputs and rebuildable indexes,
but clients read them through the Project Host and the unified Asset SDK.

Provider OAuth records store tokens encrypted; plugin broker audit rows
(`plugin_broker_audit`) record every capability operation with plugin
id/version, invocation, target, and status.

## Public Asset storage

`Settings → Public storage` or `clash host public-storage configure` configures
one machine capability shared by Desktop, CLI, MCP, and local plugins. Run
`clash host public-storage test` to verify the active backend without exposing
credentials. BYOS presets use the AWS S3 SDK:

- R2: account id, bucket, access key id, secret access key; region is `auto`.
- AWS S3: bucket, region, access key id, secret access key, and optional STS token.
- TOS: bucket, region, AK/SK; Clash derives the documented
  `https://tos-s3-<region>.volces.com` endpoint and uses virtual-hosted style.
- Custom S3: endpoint, bucket, region, AK/SK, and an optional path-style switch.

The selected backend uploads only when the exact Provider/model binding accepts
`provider-url` but not `bytes`, the Asset has no existing Provider URL, and the
Host must create a fetchable projection. It then returns a one-hour signed GET
URL. Plugin manifests never declare or receive a storage dependency; they see
only the resolved reference supplied by the Host SDK. A future authenticated
Host can satisfy the same binding through Clash-managed storage; local builds
do not show that option until the Host actually provides it.
