# Traffic Record & Replay

Clash records provider HTTP traffic — built-in providers **and** executable
plugin broker traffic — to JSONL, and replays it offline without provider
credentials or re-billing.

## Record

```sh
CLASH_PROVIDER_TRAFFIC_RECORDING_PATH=/abs/path/provider-run.jsonl \
  pnpm --filter @master-clash/desktop dev
```

Run the workflow once, stop the runtime. Recording appends; use a fresh path
for an isolated fixture.

Each broker-originated event carries a stub identifying the plugin and
provider (`pluginId:version:providerId:accountId`), so recordings from
plugin-backed generations are attributable and filterable.

## Replay

```sh
env -u GOOGLE_API_KEY -u GEMINI_API_KEY \
  CLASH_PROVIDER_TRAFFIC_REPLAY_PATH=/abs/path/provider-run.jsonl \
  pnpm --filter @master-clash/desktop dev
```

Requests match by provider/model, method, normalized URL, and normalized
body; matched fixtures are consumed in order. Binary payloads restore
byte-for-byte. A request with no matching fixture throws
`No provider test replay fixture for <METHOD> <URL>`.

The two variables are mutually exclusive; the host refuses to start with both.

## Redaction

Recordings redact auth headers, URL credentials, and secret-shaped fields as
`[redacted]`. They still contain prompts, reference media, and generated
binary data — treat recording files as **private project data**.

## Operational notes

- An interrupted final line (host killed mid-write) is tolerated on read;
  earlier corruption is not.
- Recording large reference media inflates files fast (a single base64 audio
  reference can be megabytes). Keep per-family fixtures in separate files.
- Interrupted or failed calls record with `status: 0` and the error message,
  which makes recordings useful for diagnosing flaky networks after the fact
  (connect timeouts, sockets closed mid-request) — each failure's cause chain
  is preserved exactly where it happened in the flow.
