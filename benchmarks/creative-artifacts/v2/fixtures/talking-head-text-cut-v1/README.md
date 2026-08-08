# Talking-head text-cut fixture v1

This public fixture is deliberately imperfect source media for a text-based
talking-head edit. The presenter is a consent-safe synthetic still image; lip
sync is intentionally out of scope. The audio contains a false start, filler
words, repeated words, and long pauses.

Inputs:

- `inputs/talking-head-raw.mp4`: 1920×1080, 30fps, 43.633 seconds, H.264 + mono AAC.
- `inputs/source-voice.wav`: the uncompressed mono 48kHz speech source.
- `inputs/presenter-plate.png`: the fictional presenter plate used by the source video.
- `transcript/source-voice.words.json`: Clash timed-transcript schema with 125 word units.
- `transcript/provenance.json`: TTS and alignment provenance.
- `source-script.zh-CN.txt`: the known synthetic script.

The source pack is immutable benchmark input. Import the MP4 into the Clash
project, preserve it, and make all editorial changes in a new Timeline/render.
