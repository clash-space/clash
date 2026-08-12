# Local API & Host Discovery

`local-api` is Clash's local daemon and state authority. It owns the canonical
local replica, persistence, ACP sessions, plugin processes, capability
brokering, and optional cloud connectivity. The `clash` npm package, Desktop,
and an optional daemon-only installer carry the same standalone host artifact,
discover or start one compatible machine process, and use the same data
directory. CLI and MCP expose the same capabilities as peer clients; neither
invokes the other or becomes another daemon or Project authority. Desktop exit
does not stop the shared host.

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
  "hostId": "…",
  "endpoint": "http://127.0.0.1:<port>",
  "pid": 12345,
  "launchMode": "user-service",
  "profile": "prod",
  "agentCliPath": "…/.clash/local-api/agent-bin/clash",
  "startedAt": "…",
  "updatedAt": "…"
}
```

The record is written after listen and removed on close; a stale record with a
dead pid must be treated as absent. `clash host status` wraps this.

## Selected endpoints

| Endpoint                                | Purpose                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /api/v1/models/catalog`            | Composed model catalog: card + merged provider implementations, `candidateProviders`, `selectedRoute` |
| `GET /api/v1/model-providers`           | Provider account/routing surface                                                                      |
| `GET /api/v1/local/audio/models/status` | Local ASR/TTS runtime status                                                                          |

The catalog is the ground truth for "did my binding/override land" — each
entry exposes the composed card with `providerImplementations` (including
plugin-contributed ones with their `parameterOverrides` /
`defaultParamOverrides`), plus routing outcome.

## Data at rest

| Path                                     | Contents                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `~/.clash/local-api/local.sqlite`        | Projects, assets refs, provider accounts/OAuth (encrypted values), broker + usage audit tables |
| `~/.clash/local-api/provider-secret.key` | At-rest encryption key for provider credentials (`enc:v1:` values)                             |
| `~/.clash/local-api/assets/generated/`   | Generated media files                                                                          |
| `~/.clash/cache/assets/`                 | Read-only asset cache                                                                          |

Provider OAuth records store tokens encrypted; plugin broker audit rows
(`plugin_broker_audit`) record every capability operation with plugin
id/version, invocation, target, and status.
