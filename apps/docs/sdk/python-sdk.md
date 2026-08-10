# Python SDK (`clash-sdk`)

Register and run local Python code as canvas actions, and host the local
ASR/TTS model runtimes. Same wire protocol as the JS SDK — only the host
language differs.

```sh
cd packages/clash-sdk/python
pip install -e .        # Python ≥ 3.10, aiohttp
```

## Quickstart

```python
from clash_sdk import action, ActionContext, ActionResult, run

@action(
    id="style-transfer",
    name="Style Transfer",
    output_type="image",
    parameters=[
        {"id": "style", "type": "select", "label": "Style",
         "options": [{"label": "Oil Painting", "value": "oil"},
                     {"label": "Watercolor", "value": "watercolor"}]},
    ],
    # Actions consuming reference media MUST declare modalities,
    # otherwise the action badge won't accept upstream asset edges.
    prompt_modalities=["text", "image"],
)
async def style_transfer(ctx: ActionContext) -> ActionResult:
    result = my_model(ctx.prompt, ctx.params["style"])
    return ActionResult.image(result, description="Styled image")

if __name__ == "__main__":
    run(server_url="ws://localhost:8789",
        project_id="my-project",
        token="…",              # Authorization: Bearer on the WS upgrade
        runtime_id=None)         # falls back to $CLASH_RUNTIME_ID
```

The agent connects to `ws://<server>/sync/<project_id>`, registers your
action ids, executes handlers on matching tasks, and uploads outputs.
`runtime_id` identifies which machine hosts the action; registration is
rejected without it (env fallback: `CLASH_RUNTIME_ID`). The bundled examples
(`examples/echo_action.py`, `grid_split.py`, `forced_fail.py`) read
`CLASH_SERVER_URL` / `CLASH_PROJECT_ID` / `CLASH_API_KEY`.

## `ActionContext`

Python uses snake_case for the same surface the JS SDK exposes:

| Field | Meaning |
| --- | --- |
| `task_id` / `node_id` / `project_id` / `action_id` | Identity |
| `prompt`, `params`, `model`, `output_type` | Request |
| `secrets` | Decrypted variables (worker-runtime only; local tasks get `{}` — read provider keys from your process env) |
| `reference_image_r2_keys` / `reference_video_r2_keys` / `reference_audio_r2_keys` | Reference asset keys, partitioned by modality; empty when nothing attached |
| `await ctx.fetch_asset(r2_key)` | Pull bytes for any referenced asset |

## `ActionResult`

Constructors and default mime types are identical to the JS SDK:

```python
ActionResult.image(data, mime_type="image/png", label="hero")
ActionResult.video(data)                  # video/mp4
ActionResult.audio(data)                  # audio/mpeg
ActionResult.text("summary…")             # content, skips upload
ActionResult.many([AssetOutput(type="image", data=b"…", mime_type="image/png",
                               label="tile 1/4"), …])
```

`AssetOutput.label` becomes the produced node's display name — multi-output
actions should set distinct labels (`"tile 1/4"`, `"tile 2/4"`, …) so siblings
are tellable apart on the canvas. Text outputs set `content` instead of
`data` and skip the asset upload.

`define_model` / `define_provider` / `define_serverless_provider` mirror the
JS identity helpers.

## Local model runtimes

`clash_sdk.local_models` hosts the on-device ASR/TTS backends the platform's
five ASR cards route to:

```
clash_sdk/local_models/
  asr.py         # FunASR-backed (SenseVoice)
  whisper.py     # MLX Whisper
  parakeet.py    # MLX Parakeet
  vibevoice.py   # MLX VibeVoice (long-form + diarization)
  tts.py
  rpc.py         # stdio JSON-RPC entrypoint (main())
```

The host talks to this over a typed RPC (deploy / status / remove /
transcribe / synthesize); on the JS side the same surface is
`createPythonLocalAsrRuntime` / `createPythonLocalTtsRuntime` from
`@clash-space/sdk`. Transcriptions return stable word ids with millisecond
timestamps — see [Local ASR](/guide/local-asr).

## Sandboxed executable plugins in Python

Provider executors can now ship a `.py` entrypoint. The stdio ABI is byte-for-
byte the one Node plugins speak; `clash_sdk.executable.serve` implements the
loop:

```python
from clash_sdk.executable import serve

def execute(invocation, broker):
    credential = broker({"kind": "credential.handle",
                         "secretId": "provider:my-gateway"})
    response = broker({
        "kind": "network.fetch",
        "url": "https://gateway.example/generate",
        "method": "POST",
        "headers": {"content-type": "application/json"},
        "body": {"prompt": invocation["input"]["values"]["prompt"]},
        "credentialHandle": credential["handle"],
    })
    return [{"slot": "media", "kind": "value",
             "value": {"url": response["body"]["url"],
                       "contentType": "image/png"}}]

serve({"my-gateway-execute": execute})
```

Handlers are keyed by `target.exportId` — the same dispatch contract as the
JS `defineHostedExecutablePlugin`. Raising inside a handler surfaces as a
`failed` result; broker rejections raise `BrokerError`. Contract tests and
`clash action validate/activate` drive `.py` entrypoints exactly like `.mjs`
ones.

### Interpreter resolution (app-internal first)

1. `CLASH_ACTIONS_PYTHON` — explicit override (dev/tests)
2. The **local-models venv** the app already maintains for ASR/TTS
   (`<clash-home>/runtimes/python/local-models/venv`) — reused only for
   dependency-free plugins so plugin installs never pollute the speech env
3. The **actions venv** (`<clash-home>/actions/.venv`), created on demand —
   a plugin's `requirements.txt` installs here through the existing stamped
   machinery

The pure-Python SDK arrives on `PYTHONPATH`; no pip install is needed to
`import clash_sdk.executable`.

### Sandbox parity — and one honest gap

| Guard | Node `.mjs` | Python `.py` |
| --- | --- | --- |
| Direct network denied | import-map stubs (`ERR_CLASH_PLUGIN_NETWORK_DENIED`) | injected `sitecustomize` socket stubs, same marker |
| Credential-free env | ✓ | ✓ (same builder) |
| Broker-only capabilities | ✓ | ✓ (same session, same audit) |
| Filesystem read restriction | `--permission --allow-fs-read=<pkg>` | **none yet** — Python has no `--permission` analog |

Both network guards are best-effort in-process barriers; the hard boundaries
remain the broker, the domain allowlist, and the credential-free environment.
If your plugin handles untrusted input and needs the fs guarantee, ship the
`.mjs` entrypoint.

## Python action packages

Beyond the WS agent, the bridge's action loader is interpreter-agnostic for
**plain action packages**: a manifest whose `entrypoint` ends in `.py` spawns
a prepared Python runtime (managed venv by default, or an explicit interpreter
via `CLASH_ACTIONS_PYTHON`). `.ts` entrypoints are rejected in production —
compile to `.js`.

## Boundary summary

- **Python**: canvas actions, local model runtimes, plain `.py` action
  packages, and sandboxed provider executors (network-guarded; no fs guard)
- **Node (`.mjs`)**: provider executors needing the full `--permission`
  filesystem sandbox
