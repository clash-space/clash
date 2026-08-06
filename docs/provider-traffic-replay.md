# Provider traffic record and replay

Clash can record the provider HTTP traffic produced by normal local workflows, including actions executed from Canvas, then replay the same workflow without provider network access. Gemini Omni Gateway recordings also restore their routing endpoint from the fixture, so replay does not require real Google or Cloudflare credentials.

## Record a workflow

Start the local desktop/runtime with a new absolute JSONL path:

```sh
CLASH_PROVIDER_TRAFFIC_RECORDING_PATH=/absolute/path/provider-run.jsonl \
  pnpm --filter @master-clash/desktop dev
```

Execute the target Canvas action once, then stop the runtime. Recording appends to the selected file, so use a fresh path for an isolated fixture.

## Replay offline

Restart with the recording path and no provider secrets:

```sh
env -u GOOGLE_API_KEY -u GEMINI_API_KEY -u CF_AIG_TOKEN -u GOOGLE_AI_STUDIO_BASE_URL \
  CLASH_PROVIDER_TRAFFIC_REPLAY_PATH=/absolute/path/provider-run.jsonl \
  pnpm --filter @master-clash/desktop dev
```

Execute the same Canvas action again. Provider requests are matched by provider/model, method, normalized URL, and normalized request body. Recorded responses are returned locally; binary image, video, and audio bodies are restored byte-for-byte.

The recording and replay variables are mutually exclusive. Authentication headers, credential-shaped body fields, URL credentials, and secret query parameters are stored as `[redacted]`. Recordings still contain prompts, referenced media payloads, provider responses, and generated binary data, so treat the JSONL file as private project data.
