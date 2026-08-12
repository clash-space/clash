# Volcengine Seed Audio 1.0 upstream snapshot

Captured on 2026-08-13 from the official Volcengine Doubao Speech documentation:

- [Audio generation HTTP API](https://docs.volcengine.com/docs/6561/2550782?lang=zh)
- [Doubao Speech model list](https://docs.volcengine.com/docs/6561/2499930?lang=zh)

This is a local source-of-truth snapshot for the `volcengine-speech` Provider contributed by the
`clash.volcengine` plugin and the `seed-audio-1` Model Card. It is not a replacement for the
upstream documentation.

## Service boundary

Seed Audio does not use the ModelArk Seedance endpoint or credentials.

- Method and endpoint: `POST https://openspeech.bytedance.com/api/v3/tts/create`
- Authentication: `X-Api-Key`
- Model: `seed-audio-1.0`
- Clash Provider id: `volcengine-speech`
- Clash account fields: `apiKey` and optional `baseUrl`
- Default Clash base URL: `https://openspeech.bytedance.com/api/v3`

ModelArk and Doubao Speech are separate Clash Providers because they issue different credentials,
use different hosts, and have different lifecycles. They remain bundled in the same first-party
plugin package, but an account for `volcengine` never satisfies a `volcengine-speech` route (or vice
versa). The selected account's scoped store exposes the conventional `apiKey` and `baseUrl` names
to its executor.

Seed Audio also has a separate Hilo implementation contributed by the Hilo plugin. That route is a
peer implementation of the same Model Card, not an alias for the official Volcengine Speech
account.

## Inputs

- `text_prompt` is required and accepts at most 3,000 characters.
- Supported modes are text only, text plus one image, or text plus audio references.
- Images and audio references cannot be mixed.
- One image is supported. Published formats are JPEG, PNG, and WebP; maximum size is 10 MiB.
- Up to three audio references are supported. Each may be at most 30 seconds and 10 MiB.
- Published reference audio formats are WAV, MP3, PCM, and Ogg Opus.
- Audio references are addressed in the prompt as `@音频1`, `@音频2`, and `@音频3` in list order.
- A reference audio may be sent as Base64 (`audio_data`), a URL (`audio_url`), or a Doubao TTS /
  voice-clone speaker ID (`speaker`). Those fields are mutually exclusive within one reference.

Clash strips the prefix from Base64 Data URLs before populating `audio_data` or `image_data`; normal
URLs are passed as `audio_url` or `image_url`.

## Audio controls

| Clash parameter | Upstream field | Published values |
| --- | --- | --- |
| `voice_id` | `references[].speaker` | Doubao TTS or voice-clone speaker ID |
| `speed` | `audio_config.speech_rate` | 0.5–2.0×, mapped to `-50`–`100` |
| `volume` | `audio_config.loudness_rate` | 0.5–2.0×, mapped to `-50`–`100` |
| `pitch` | `audio_config.pitch_rate` | Integer `-12`–`12` |
| `sample_rate` | `audio_config.sample_rate` | `8000`, `16000`, `24000`, `32000`, `44100`, `48000` |
| `format` | `audio_config.format` | `wav`, `mp3`, `pcm`, `ogg_opus` |

The API page currently states a default sample rate of `40000`, while its own allowed-value list
does not contain `40000`. Clash therefore does not invent a sample-rate default and omits the field
until the user selects one. The published output format default is WAV.

## Output

- Maximum generated duration is 120 seconds.
- `audio` contains Base64 audio bytes.
- `url` is a temporary audio URL valid for two hours.
- The Clash executor prefers `audio` so the Host can persist the bytes immediately, and accepts
  `url` as a fallback because the official response example contains only the URL.
- `duration` is the post-processed duration; `original_duration` is the billed model-output duration.
