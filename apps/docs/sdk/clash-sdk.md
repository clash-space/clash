# @clash-space/sdk

Register and run local Node.js code as canvas actions, plus typed local
ASR/TTS runtimes.

```sh
pnpm add @clash-space/sdk
```

## Define an action

```ts
import { defineAction, actionResult, run } from "@clash-space/sdk";

const posterize = defineAction({
  id: "posterize",
  name: "Posterize",
  outputType: "image",
  // Modalities accepted inline in the prompt editor — drives which
  // @-mention chips show up. Actions consuming reference media MUST
  // declare them; default is ["text"].
  promptModalities: ["text", "image"],
  parameters: [
    { id: "levels", label: "Levels", type: "number", defaultValue: 4 },
  ],
  async handler(ctx) {
    // Reference media arrives as R2 storage keys, partitioned by modality;
    // fetch bytes on demand. Arrays are empty when nothing is attached.
    const [srcKey] = ctx.referenceImageR2Keys;
    const src = srcKey ? await ctx.fetchAsset(srcKey) : undefined;
    const bytes = await processImage(src, ctx.params.levels);
    return actionResult.image(bytes, { description: "Posterized" });
  },
});

await run({ actions: [posterize] });
```

`run(opts)` starts a `ClashAgent` that connects to the host, receives tasks
for your registered actions, executes handlers, and uploads outputs.
`agent.stop()` shuts down cleanly.

## Connecting: `RunOptions`

`run(opts)` / `new ClashAgent(opts)` take four required fields:

```ts
await run({
  // WS or HTTP URL of the server — converted internally for the WS handshake.
  serverUrl: "http://127.0.0.1:<port>",   // resolve via ~/.clash/run/host.json
  projectId: "<project-id>",
  // Any API token bound to the user (same agentApiKey the bridge daemon
  // uses). Sent as `Authorization: Bearer …` on the WS upgrade.
  apiKey: process.env.CLASH_API_KEY!,
  // Runtime row id from ~/.clash/credentials.json#runtimeId. Sent as the
  // `x-runtime-id` header — the server rejects registrations without it.
  runtimeId: process.env.CLASH_RUNTIME_ID!,
  actions: [posterize],
});
```

The agent connects to `<ws>/sync/<projectId>`, registers your action ids,
receives matching tasks, and uploads outputs back as project assets.
Construction throws immediately if `runtimeId` is missing.

## Result constructors

`actionResult.image | video | audio | text | many` mirror the
[Python SDK's](/sdk/python-sdk) `ActionResult.*` (same defaults on both
sides):

```ts
actionResult.image(buf, { mimeType: "image/png", label: "hero" });
actionResult.video(buf);                    // video/mp4 default
actionResult.audio(buf);                    // audio/mpeg default
actionResult.text("summary…");
actionResult.many([{ type: "image", data, mimeType: "image/png" }]);
```

## Identity helpers

`defineAction`, `defineModel`, `defineProvider`, `defineServerlessProvider`
are typed identity functions — they exist so misshapen manifests fail in your
IDE, not at runtime.

- `ActionDefinition.model` (an `ActionModel`) binds the action to a MaaS /
  official model so the platform surfaces the right API key in Settings.
- `ActionDefinition.secrets` adds extra required variables; provider model
  bindings auto-add the provider key, so most actions don't need it.
- `ServerlessProviderDefinition` + `ServerlessProviderHandler` describe
  request/response provider shims.

## Local model runtimes

Typed wrappers over the Python local-model runtime (RPC):

```ts
import { createPythonLocalAsrRuntime, createPythonLocalTtsRuntime } from "@clash-space/sdk";

const asr = createPythonLocalAsrRuntime({ /* PythonLocalAsrRuntimeOptions */ });
const { words, segments } = await asr.transcribe({ assetPath, language: "zh" });
// LocalAsrWord: stable ids + millisecond timestamps (+ confidence/speaker where available)

const tts = createPythonLocalTtsRuntime({ /* … */ });
const audio = await tts.synthesize({ text: "你好", voice: "…" });
```

Deploy/status/remove for local models go through the same RPC surface
(`LocalModelRpcInvoker`, `LocalModelStatus`).
