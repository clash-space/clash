# `@clash/sdk`

`@clash/sdk` contains typed clients for Clash's on-device ASR/TTS model
runtimes. Provider and canvas-action plugins use
[`@clash/action-sdk`](/sdk/action-sdk) and the `clash.plugin/v1` executable
protocol instead.

```sh
pnpm add @clash/sdk
```

## Local model runtimes

The clients wrap the app-managed Python runtime over its typed RPC transport:

```ts
import {
  createPythonLocalAsrRuntime,
  createPythonLocalTtsRuntime,
} from "@clash/sdk";

const asr = createPythonLocalAsrRuntime({ /* PythonLocalAsrRuntimeOptions */ });
const { words, segments } = await asr.transcribe({
  assetPath,
  language: "zh",
});

const tts = createPythonLocalTtsRuntime({ /* PythonLocalTtsRuntimeOptions */ });
const audio = await tts.synthesize({ text: "你好", voice: "…" });
```

Deploy, status, and removal use the same RPC surface through
`LocalModelRpcInvoker` and `LocalModelStatus`.

## Retired agent transport

`ClashAgent`, `defineAction`, `actionResult`, and `run` are no longer exported.
They used a ProjectRoom WebSocket plus `/api/custom-action/upload`, which
bypassed the Host-owned durable run and Project Asset protocols. Local
executable plugins now receive Host-scoped account, reference, and output
dependencies through the plugin SDK.
