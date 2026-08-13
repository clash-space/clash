# Contract Tests

Contract tests gate every activation. Each JSON case drives the real built
stdio entrypoint and checks the invocation/result ABI.

## Shape

```json
{
  "apiVersion": "clash.plugin.contract-test/v1",
  "id": "acme-submit",
  "target": {
    "exportId": "acme-execute",
    "kind": "provider-executor"
  },
  "operation": "submit",
  "input": {
    "values": {
      "modelId": "acme-image",
      "prompt": "A red circle"
    },
    "references": []
  },
  "expect": {
    "status": "accepted",
    "pollState": { "taskId": "task-1" }
  }
}
```

The runner supplies deterministic Host-scoped store, reference, upload, and
Host-tool dependencies. Plugin tests stub the plugin process's normal HTTP
client; they do not call a Host network API.

## What to cover

1. Every operation declared by the contribution: synchronous `submit`, queued
   `submit`, `poll`, and the reserved future `callback` ABI when declared.
2. Request projection: vendor model name, parameters, ordered references, and
   auth headers derived from scoped store values.
3. Response projection: text, each media kind, queued state, terminal vendor
   failures, and malformed responses.
4. Large-result upload and URL-result persistence paths.

For first-party providers, each executor invocation may make at most one
corresponding upstream submit or status request. The Host owns retry timing;
provider executors must neither sleep nor retry internally, and transport
errors must be surfaced rather than translated into `accepted`. A successful
status response may still require one follow-up file fetch when the provider
returns a file identifier instead of the result URL.

Contract cases must be deterministic and credential-free. They prove the
plugin package and SDK shape. They do not claim a vendor currently accepts the
request.

## Running

```sh
clash plugin validate <dir>
clash plugin activate <dir>
```

Both commands build a declared TypeScript entrypoint and run every file listed
in `manifest.json#contractTests`. Activation stops on the first failing case.

## Pair contracts with traffic replay

For providers, keep a second backend acceptance suite created from real,
redacted upstream traffic. That suite runs Project/Canvas → local-api → real
plugin process → persisted text or asset, with the plugin process's HTTP
instrumented externally. See [Traffic Record & Replay](/plugins/traffic-replay).

CLI, GUI, and MCP are peer clients of this backend. One backend acceptance per
case covers the shared project operation; client-specific tests only need to
cover their own command or UI projection.
