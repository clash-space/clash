# Python SDK (`clash-sdk`)

The Python package supplies the `clash.plugin/v1` executable-plugin helper and
the app's local ASR/TTS model runtimes. Python 3.10 or newer is required.

```sh
cd packages/clash-sdk/python
pip install -e .
```

## Executable provider plugin

A Python entrypoint speaks the same newline-delimited invocation/result ABI as
a Node entrypoint. The Host chooses the account before invocation and injects
an already-scoped context:

```python
import httpx
from clash_sdk import serve


async def submit(invocation, context):
    token = await context.store.get("accessToken")
    if not token:
        raise RuntimeError("This account has no accessToken stored.")

    response = httpx.post(
        "https://api.acme.example/generate",
        headers={"authorization": f"Bearer {token}"},
        json={"prompt": invocation["input"]["values"].get("prompt", "")},
    )
    response.raise_for_status()
    body = response.json()
    return {"status": "accepted", "pollState": {"taskId": body["taskId"]}}


serve({"acme-execute": {"submit": submit}})
```

The same helper remains available as `clash_sdk.executable.serve`.

Use the language's normal HTTP, filesystem, and process APIs. Provider I/O is
not routed through the Host. The test runner instruments the process
externally for deterministic traffic recording and replay.

Credentials come from `context.store`, not invocation values or process
environment variables. The Host owns account selection, retry policy, poll
cadence, total run lifetime, restart recovery, and Project publication.

## References and outputs

- `await context.reference(reference)` sends the complete reference to the Host
  and returns typed text, decoded `bytes`, or
  `{ "form": "provider-url", "providerUrl": ..., "expiresAt": ... }`.
  `bytesBase64` exists only on the broker wire and is decoded by the SDK.
- `await context.upload(...)` stages large results without placing base64 in a
  stdio frame.
- `await context.asset(...)` stages a small typed output and returns its Host
  handle. The Durable Run Engine checkpoints the completed result before its
  separate idempotent Project publication step.
- `context.host_tools` contains only explicitly contributed Host tools.

Plugin code never receives the Project database path or storage layout.

## Interpreter resolution

1. `CLASH_ACTIONS_PYTHON` for an explicit development/test override.
2. A compatible app-managed Python environment.
3. The actions environment created for plugin dependencies.

The pure-Python helper is added through `PYTHONPATH`; a plugin may ship a
`requirements.txt` for its own vendor libraries.

## Local model runtimes

`clash_sdk.local_models` hosts on-device ASR/TTS backends. The Host uses their
typed deploy/status/remove/transcribe/synthesize RPC surface. This is separate
from provider plugins: a local model runtime performs inference on the machine,
while a provider executor adapts a catalog route to an upstream service.

## Retired agent transport

The Python package no longer exports `ClashAgent`, `@action`, `ActionResult`,
or `run`. Those APIs used the retired ProjectRoom custom-action transport.
Use an executable plugin manifest plus `serve` for project operations.
