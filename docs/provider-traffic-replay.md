# Provider traffic record and replay

The canonical user and plugin-author guide is
[`apps/docs/plugins/traffic-replay.md`](../apps/docs/plugins/traffic-replay.md).

Provider plugins own their HTTP stack. The test runner instruments the plugin
process before its entrypoint starts, records real upstream traffic with secret
redaction, and can replay that traffic with real network egress disabled. The
production SDK does not provide an HTTP client and provider business code does
not branch for recording.

## Live capture

Use a private, ignored JSONL path and an explicit live configuration:

```sh
CLASH_PROVIDER_E2E=live \
CLASH_PROVIDER_E2E_CONFIG="$PWD/.clash-provider-traffic/provider-e2e.json" \
pnpm --filter @clash/local-api exec vitest run \
  src/real-generation-google.test.ts src/real-generation-minimax.test.ts
```

The configuration selects the Host-owned provider account and recording path.
Credentials remain in the encrypted local account store; do not copy them into
fixtures or commands. Record each supported API family, including submit/poll,
uploads, final media downloads, mixed references, and resume-after-restart.

## Offline replay

Checked-in fixtures run through the shared local-api backend with provider
credentials removed:

```sh
env -u GOOGLE_API_KEY -u GEMINI_API_KEY -u CLASH_MINIMAX_API_KEY \
  pnpm --filter @clash/local-api test
```

Replay matches normalized method, URL, and body in order. A missing request is
an error and never falls through to the real network. The backend grader checks
the final text revision or persisted media asset, not merely an upstream HTTP
status.

Before promoting a private recording, prove that replay passes without
credentials and search it for authorization values, signed query parameters,
private keys, and absolute local paths. Prompts, references, provider responses,
and generated media remain test data and require normal fixture review.
