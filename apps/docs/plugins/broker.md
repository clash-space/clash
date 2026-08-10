# Capability Broker & Security

Plugins run sandboxed: filesystem read-only on their own package, **all
network primitives replaced with throwing stubs**. The broker is the only door
out, and every request through it is checked and audited.

## Operations

| Operation | Requires | Does |
| --- | --- | --- |
| `credential.handle` | `secrets: ["provider:<id>"]` | Mints an opaque handle for an enabled provider account or authorized OAuth record |
| `network.fetch` | domain in `network.domains`; `externalWrites` for non-GET | Executes the HTTP call host-side, injecting real auth headers |
| `asset.read` | `assets: ["read"]` | Reads a **project-scoped** asset (id + invocation's project must match) |
| `asset.write` | `assets: ["write"]` | Persists bytes as an immutable project asset |
| `codex.image.generate` | `hostTools: ["codex.imagegen"]` **plus** `assets: ["write"]` (and `assets: ["read"]` when references are attached) | Host-run image generation persisted as a project asset |

## Credential handles

```
plugin                       broker
  │ credential.handle          │
  │────────────────────────────▶ resolves enabled account / OAuth record
  │ ◀ clash-secret://<uuid> ───│ stores { invocationId, pluginId, providerId,
  │                            │          credentials, expiresAt }
  │ network.fetch + handle     │
  │────────────────────────────▶ validates handle ∈ invocation ∧ plugin
  │                            │ injects provider-specific auth headers
```

- The plugin **never sees the token**. Auth headers are injected host-side per
  provider shape (`fal → Key`, `replicate → Token`, `elevenlabs → xi-api-key`,
  `google → x-goog-api-key`, gateway-specific double headers, …).
- Handles are bound to `invocationId` + `pluginId`; using another invocation's
  handle fails.
- **TTL**: default 30 minutes, configurable via
  `CLASH_PLUGIN_CREDENTIAL_TTL_MINUTES`. The default deliberately exceeds the
  longest executor polling ceiling (300 × 5 s = 25 min) — a shorter TTL once
  discarded already-billed video tasks mid-poll. The TTL is a backstop, not
  the security boundary: a plugin holding the matching `provider:*` permission
  can mint a fresh handle at any time. The real boundaries are the sandbox,
  the domain allowlist, and the invocation binding. The TTL still bounds
  leaked handles and caps the in-memory handle map, which reclaims entries
  only on expiry.

## Auditing

Every broker operation appends to `plugin_broker_audit` (SQLite): plugin id +
version, project, invocation, request id, operation, target host, status,
error. One generation reads as a clean chain: `credential.handle` →
`network.fetch` (submit) → `network.fetch` (polls) → `network.fetch` (file).

## Redaction guarantees

Traffic recordings redact credential-shaped headers (`authorization`, `token`,
`api-key`, `x-api-key`, `xi-api-key`, `x-goog-api-key`, …), URL credentials,
and secret-shaped body fields as `[redacted]`. Tokens must never appear in
plaintext in recordings — this is asserted by host tests.

## Failure modes worth knowing

- `Credential handle is unknown or expired.` — handle TTL elapsed or handle
  from another invocation. Long executors should keep polling well inside the
  TTL; hosts can raise it via the env var.
- `Network domain <host> is not declared by plugin <id>.` — add the domain to
  `permissions.network.domains` and re-activate (permission increase prompts).
- `External writes are not declared by plugin <id>.` — POST/PUT without
  `externalWrites: true`.
