# Python SDK (`clash-sdk`)

The Python SDK supports canvas actions, local model runtimes, and executable
plugins. Python 3.10 or newer is required.

```sh
cd packages/clash-sdk/python
pip install -e .
```

## Canvas action quickstart

```python
from clash_sdk import action, ActionContext, ActionResult, run

@action(
    id="style-transfer",
    name="Style Transfer",
    output_type="image",
    prompt_modalities=["text", "image"],
)
async def style_transfer(ctx: ActionContext) -> ActionResult:
    result = my_model(ctx.prompt)
    return ActionResult.image(result, description="Styled image")

if __name__ == "__main__":
    run(
        server_url="ws://localhost:8789",
        project_id="my-project",
        token="...",
    )
```

`ActionResult.image`, `video`, `audio`, `text`, and `many` produce the same
canonical outputs as the JavaScript SDK.

## Executable provider plugin

A Python entrypoint speaks the same newline-delimited invocation/result ABI as
a Node entrypoint. The SDK supplies a context whose store, reference, and
upload methods are already scoped by the Host:

```python
import httpx
from clash_sdk.executable import serve

async def submit(invocation, context):
    token = await context.store.get("accessToken")
    if not token:
        raise RuntimeError("This Acme account has no accessToken stored.")

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

Use the language's normal HTTP, filesystem, and process APIs. Provider I/O is
not routed through the Host. For deterministic tests, the runner instruments
the plugin process externally and records or replays its normal HTTP stack.

Credentials must come from `context.store`, not invocation values or process
environment variables. The Host chooses the account and binds its state before
the entrypoint receives the invocation.

## References and uploads

- `await context.reference(reference)` returns typed text, bytes, or URL data.
- `await context.upload(...)` stores large results without placing base64 in a
  stdio frame.
- typed text/media results become canonical Project revisions and assets.

Plugin code never receives the Project database path or object-store layout.

## Interpreter resolution

1. `CLASH_ACTIONS_PYTHON` for an explicit development/test override.
2. A compatible app-managed Python environment.
3. The actions environment created for plugin dependencies.

The pure-Python SDK is added to `PYTHONPATH`; a plugin may ship a
`requirements.txt` for its own HTTP or vendor libraries.

## Local model runtimes

`clash_sdk.local_models` hosts on-device ASR/TTS backends. The Host uses their
typed deploy/status/remove/transcribe/synthesize RPC surface. This is separate
from provider plugins: a local model runtime performs inference on the machine,
while a provider executor adapts a catalog route to an upstream service.
