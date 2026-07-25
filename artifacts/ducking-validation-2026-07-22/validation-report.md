# Audio ducking validation — 2026-07-22

## Fixture

- Timeline: 240 frames, 30 fps, 1280×720 (8 seconds)
- Music: 440 Hz, frames 0–239
- Voice trigger: 1000 Hz, frames 60–149
- Ducking: -18 dB, 6-frame attack, 12-frame release

## Preview playback

Status: PASS

| Sample | Playhead | Heading | Music element volume |
| --- | ---: | --- | ---: |
| Before voice | 28 | BEFORE SPEECH · MUSIC 0 dB | 1.0 |
| Voice active | 88 | DUCKING ACTIVE · MUSIC -18 dB | 0.1258925412 |
| After voice | 208 | RELEASE · MUSIC RESTORED | 1.0 |

`0.1258925412` equals the linear gain for `-18 dB`.

## Render output

Renderer status: PASS through the desktop-backed local API render processor.

- Video: H.264, 1280×720, 30 fps
- Audio: AAC, 48 kHz, stereo
- Duration: 8.042667 seconds
- File size: 437,529 bytes

440 Hz band-pass measurements:

| Segment | Mean volume | Difference from before |
| --- | ---: | ---: |
| Before voice, 0.5–1.5 s | -31.0 dB | — |
| Voice active, 3.0–4.0 s | -49.1 dB | -18.1 dB |
| After voice, 6.2–7.2 s | -31.0 dB | 0.0 dB |

## Desktop backend Export

Status: PASS in a normal Electron development launch.

- `Export → Export video` created backend node `render-10db8854-9390-441d-aec6-556df5c27201`.
- The node progressed from `pending` to `completed` through the local API processor.
- `actorUserId` is `local-user`.
- `renderTarget` is parent Canvas `main`, linked to Timeline Action node `timeline-action-mrw7wk4n`.
- The completed video asset is `local-asset-local-render-render-10db8854-9390-441d-aec6-556df5c27201` and is visible both on the parent Canvas and in Project Assets.
- Final output: `backend-ducking-render.mp4`.

The UI no longer invokes a renderer IPC or opens a native save dialog. Electron supplies the real Remotion renderer to the local API backend, which resolves current local asset URLs, writes the generated asset, and completes the Canvas node.

One earlier node remains failed as diagnostic evidence: it referenced a signed asset URL from a stale local API port. The resolver now rebuilds local asset URLs from the current backend base URL; the successful node above verifies that fix end to end.
