# Rhythm bed v1

This public fixture defines an eight-second, 120 BPM synthetic rhythm bed. It
contains no recording, sample, melody, voice, logo, or third-party artwork.
The beat map and integer-only PCM generator are released under CC0-1.0 for
reproducible benchmark use.

Generate a derived WAV outside this immutable input directory:

```bash
node inputs/generate-beat.ts derived/rhythm-bed.wav
```

When the fixture is installed by the benchmark runner, its files appear under
`inputs/`, so the command above preserves the input manifest. Chapter
downbeats are beat indices 0, 4, 8, and 12; the intervening beats make visual
sync and rhythmic variation observable without prescribing the final design.
