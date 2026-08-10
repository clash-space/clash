# Contract Tests

Contract tests gate every activation. Each is a JSON document that drives the
**real bundled handler** over stdio against fixed broker fixtures, then
deep-compares every request your executor makes.

## Shape

```json
{
  "apiVersion": "clash.plugin.contract-test/v1",
  "id": "my-image-flow",
  "target": { "exportId": "my-gateway-execute", "kind": "provider-executor" },
  "input": {
    "values": {
      "modelId": "nano-banana-2",
      "upstreamModel": "nano_banana_2_flash",
      "prompt": "A paper moon",
      "aspectRatio": "16:9",
      "modelParams": { "resolution": "1K" }
    },
    "references": []
  },
  "brokerFixtures": [
    {
      "operation": { "kind": "credential.handle", "secretId": "provider:my-gateway" },
      "response": { "status": "ok", "result": { "handle": "clash-secret://contract", "providerId": "my-gateway" } }
    },
    {
      "operation": {
        "kind": "network.fetch",
        "url": "https://gateway.example/api/v2/image/generate?version_code=2.0.11",
        "method": "POST",
        "headers": { "content-type": "application/json" },
        "body": { "prompt": "A paper moon", "aspect_ratio": "16:9", "resolution": "1K" }
      },
      "response": { "status": "ok", "result": { "status": 200, "headers": {}, "body": { "task_id": "t-1", "status": "success", "image_url": "https://cdn.example/img.png" } } }
    }
  ]
}
```

## Matching is strict

- URLs compare **exactly** (including query strings) — dynamic values like
  timestamps can't be embedded in fixture URLs.
- Bodies deep-compare. A fixture consumed out of order or left unconsumed
  fails the run (`consumed 1 of 3 broker fixtures`).
- The handler under test is the **built bundle**, the same artifact that
  activation attests.

## What they prove — and what they can't

Contract tests prove your executor emits exactly the requests you declared,
and that activation can't regress that shape. They **cannot** prove the
upstream accepts those requests: the fixtures are written by the same person
who wrote the executor. Every real-world break found in one production
audit — a value-case mismatch, a conditional ratio rule, an envelope that says
`success` while the task failed — was invisible to green contract tests.

Treat contracts as the regression floor. Ground truth comes from one recorded
real run per API family ([Traffic Record & Replay](/plugins/traffic-replay));
after a real run, tighten fixtures to match reality (e.g. fixture bodies now
carry `"resolution": "2k"` after the binding override, not the card's `2K`).

## Running

```sh
clash action validate <dir>    # runs all declared contract tests
clash action activate <dir>    # re-runs them; any failure blocks activation
```
