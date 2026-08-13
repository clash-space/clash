# Traffic Record & Replay

An upstream-acceptance Provider fixture comes from a real upstream run. The
same Project backend case is then replayed offline, byte-for-byte, without
credentials or provider billing. A deterministic fixture or contract test that
was not recorded upstream must not be described as live traffic.

## Process-boundary instrumentation

Provider plugins own HTTP directly. The test runner instruments the plugin
process before its entrypoint starts and observes the runtime's normal HTTP
stack. Recording and replay are runner concerns; production SDK context does
not carry an HTTP client and plugin code does not change for tests.

The Node boundary captures submit, poll, vendor upload/download, redirects, and
final asset fetches made by the plugin. Python processes are instrumented before
their entrypoint through `sitecustomize`; the adapter currently supports the
standard-library `urllib.request`, `requests`, sync and async `httpx`, and
`aiohttp`. It buffers each supported client's logical request and response;
client-managed redirect loops may therefore be represented by their final
logical response rather than every intermediate hop. The three optional
libraries are patched only when installed, so their absence does not prevent a
Python plugin from starting. Multipart bodies exposed as encoded bytes are
stored semantically by field and file digest, so a fresh random boundary still
matches replay.

Do not assume an arbitrary Python HTTP stack is covered. A plugin using another
client, a native extension, or its own socket/TLS transport needs a test-runner
adapter plus the same record → offline replay → unmatched-request regression
before its traffic fixture is accepted. An unmatched request in a supported
client fails inside the plugin process and never falls through to real egress.

## Record a real run

```sh
CLASH_PROVIDER_E2E=live \
CLASH_PROVIDER_E2E_CONFIG="$PWD/.clash-provider-traffic/provider-e2e.json" \
pnpm --filter @clash/local-api exec vitest run \
  src/real-generation-google.test.ts src/real-generation-minimax.test.ts
```

Keep credentials and temporary recordings under the ignored
`.clash-provider-traffic/` directory:

```json
{
  "env": {
    "CLASH_MINIMAX_API_KEY": "...",
    "CLASH_MINIMAX_RECORDING_PATH": "/absolute/private/minimax.jsonl",
    "CLASH_PROVIDER_E2E_TIMEOUT_MS": "1800000"
  }
}
```

Each case has a 30-minute total lifetime by default. Set
`CLASH_PROVIDER_E2E_TIMEOUT_MS` in the process environment or the config file's
`env` object only when a documented upstream model needs a different budget;
individual HTTP calls and Provider-owned client timeouts remain separate.

Run every supported provider family at least once: text, image, video, speech,
music, reference inputs, and queued resume paths where the catalog exposes
them. A successful HTTP response is not enough; grade the completed backend
result.

The current repo-owned live recordings cover Google, MiniMax, and the Hilo Hub
peer. The first-party fal executor has contract and durable-backend coverage,
but no checked-in real-upstream traffic fixture yet; it is therefore not
live-verified by this suite.

### Third-party provider plugins

Third-party plugins use the same harness. The case suite supplies a
`preparePlugins` callback that activates the exact source or packaged plugin in
the harness's isolated actions root; recording still happens at the spawned
plugin process boundary. Do not add recorder branches to plugin production
code.

`hrhrng.hub` is the maintained example. Its live suite reads the selected Host
account and scoped plugin secret, records one targeted case to a fresh file,
and its offline suite reactivates the same plugin before replay:

```sh
CLASH_PROVIDER_E2E=live \
CLASH_PROVIDER_E2E_CONFIG="$PWD/.clash-provider-traffic/provider-e2e.json" \
CLASH_PROVIDER_E2E_TARGETS=hilo-seedance-2-audio-reference \
pnpm --filter @clash/local-api exec vitest run \
  src/real-generation-hilo.test.ts
```

Keep the account id, local data directory, and recording path in the ignored
configuration file; keep its access token in the Host plugin store. A plugin
without a repo-owned live suite should first add cases, source/package
activation, a live recorder, and an offline backend replay test. Contract tests
alone are not upstream acceptance.

## Replay offline

Checked-in fixtures run in the normal local-api test suite:

```sh
env -u GOOGLE_API_KEY -u GEMINI_API_KEY -u CLASH_MINIMAX_API_KEY \
  pnpm --filter @clash/local-api test:providers
```

The matching opt-in live recorder entry point is
`pnpm --filter @clash/local-api test:providers:live` with
`CLASH_PROVIDER_E2E=live` and the config file above. These maintained commands
cover Google, MiniMax, and Hilo. Volcengine has its own provider workstream and
is deliberately not hidden inside either command.

Replay blocks real egress from the instrumented plugin process. Requests
match by method, normalized URL, and normalized body, and matching fixtures are
consumed in order. Binary image, video, and audio bodies are restored exactly.
An unmatched request fails the test instead of falling through to the network.

## Backend grader

Assert the shared product outcome:

- the generated Canvas node reaches `completed`;
- text is a non-empty canonical string with a text revision;
- media has the expected kind and MIME type and is persisted as a project
  asset;
- queued work resumes from recorded poll state without resubmission;
- reference order and media types survive projection into the vendor request.

These fixtures become repair graders: reproduce a provider bug with a real
recording, add the failing backend assertion, fix the adapter, and retain the
case for later regression runs.

## Redaction and review

Recordings must redact authorization headers, URL credentials, signed query
parameters, and secret-shaped request fields. Before committing a fixture:

1. verify the real backend case completed;
2. verify replay succeeds with provider credentials removed;
3. search the JSONL for the original credential and local absolute paths;
4. review prompts, references, and generated media, which are test data and
   are not removed by secret redaction.

Use a fresh recording path for each run. Interrupted final lines may be
ignored, but earlier corruption must fail. Keep large provider families in
separate fixtures so one audio or video payload does not make every test load
unrelated data.
