# Local ASR & Transcripts

ASR is a first-class model kind. Five built-in cards run **entirely
on-device** — no provider account, no billing, no network:

| Card | Local model | Strengths |
| --- | --- | --- |
| `sensevoice-small-asr` | `iic/SenseVoiceSmall` | Fast; Mandarin, Chinese-English, Cantonese |
| `whisper-large-v3-turbo-asr` | `mlx-community/whisper-large-v3-turbo` | High-accuracy multilingual, word-level timestamps (MLX) |
| `whisper-small-asr` | `mlx-community/whisper-small-mlx` | Lower-memory Macs |
| `parakeet-tdt-0.6b-v3-asr` | `mlx-community/parakeet-tdt-0.6b-v3` | 25 European languages, fast |
| `vibevoice-asr` | `mlx-community/VibeVoice-ASR-4bit` | Long-form, speaker diarization |

All five are ordinary cards with `providerId: "local"` implementations — same
registry, same composition, same routing as cloud models.

## Transcript pipeline

One agent-readable path from a media asset to editable transcript artifacts:

```
asset audio/video
  → local ASR runtime (FunASR or MLX backend; word timestamps, milliseconds)
  → clash.asr.timed-transcript
  → Timeline assetTranscripts
  → GUI word-bar editing / text-cut
  → clash timeline pull
      → *.timeline.yaml       (editable source of truth)
      → *.transcript.json     (read-only word-to-frame map)
  → clash timeline apply
```

Data boundaries:

- **Raw ASR uses milliseconds** and preserves exactly what the model returned:
  stable word ids, segments, optional confidence/speaker ids, and
  backend/model/language provenance.
- **Timeline planning uses frames**: `startMs` floors, `endMs` ceils, and every
  word receives at least one frame.

## Runtime management

```sh
clash models              # includes local audio model management
```

Local model deploy/status/remove and the ASR/TTS runtimes are also scriptable
from the JS SDK (`createPythonLocalAsrRuntime`,
`createPythonLocalTtsRuntime` in `@clash-space/sdk`), which wrap the Python
runtime over a typed RPC surface (`LocalModelRpcInvoker`).
