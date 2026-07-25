# Local ASR and Transcript System

## Outcome

Clash now has one local, agent-readable path from a specific media asset to
transcript editing artifacts:

```text
asset audio/video
  -> FunASR (word timestamps in milliseconds)
  -> clash.asr.timed-transcript
  -> Timeline assetTranscripts
  -> GUI Timeline edit / primary-track wordbar
  -> clash timeline pull
       -> *.timeline.yaml (editable source of truth)
       -> *.transcript.json (read-only word-to-frame map)
  -> clash timeline apply
```

This extends the existing text-cut and caption system. It does not introduce a
parallel transcript model, and every transcript/cut remains scoped to its
source asset.

## Data boundaries

1. Raw ASR uses milliseconds. It preserves what the model actually returned,
   stable word ids, segments, optional confidence/speaker ids, and
   backend/model/language provenance.
2. Timeline planning uses frames. `startMs` is floored, `endMs` is ceiled, and
   every word receives at least one frame.
3. Source media and raw ASR remain immutable. Transcript corrections update the
   cached transcript text only. Media cuts update Timeline DSL clip boundaries.
4. Timeline DSL is the editable source of truth. The transcript projection is a
   revision-pinned read model and is never applied as an edit.

The canonical raw contract is `AsrTimedTranscriptSchema` in shared types. The
Python and JavaScript SDKs mirror the same wire shape. The JavaScript boundary
rejects text-only, malformed, duplicate-id, out-of-order, or out-of-duration
responses instead of pretending they are word aligned.

## Manual GUI editing

Captions keeps two explicit manual edit modes:

- `Caption text` edits caption cue copy without changing source media.
- `Timeline edit` projects the primary spoken-media track as editable words.

Clicking a transcript word seeks to its exact timeline start frame. Selecting
words and pressing Delete immediately ripple-deletes the matching frame range;
Undo restores it non-destructively. Correcting one word updates transcript text
without cutting media. There is intentionally no automatic filler-removal
entry in the GUI.

The primary track also renders a synchronized wordbar below its video/audio
waveform. Word tiles use their real frame widths, the current word highlights
during playback, and inter-word pauses are rendered as real-width blocks such
as `0.2s` or `0.5s`. Both words and pauses seek the playhead.

## Agent text-based editing

`clash timeline pull --timeline <id>` writes the editable Timeline YAML and,
when the primary track has word-aligned speech, a sibling transcript projection
plus hashed per-asset transcript sidecars. Every projected word keeps both
coordinate systems:

- `assetId + assetWordId + sourceStartFrame/sourceEndFrame`
- `clipId + trackId + timelineStartFrame/timelineEndFrame`

The projection is pinned to `timelineId + timelineRevision` and each generated
source sidecar's path/hash. Trims and playback rate are accounted for when
mapping source words into timeline time. Reusing one source word in two clips
creates two timeline word instances, while the source word remains immutable.

The Agent reads `*.transcript.json`, decides the manual edit boundaries, changes
the corresponding clip boundaries in `*.timeline.yaml`, and applies that YAML
through the normal observed-read/CAS boundary. The Agent does not invoke a
hidden “remove filler words” operation. `plan-text-cut` remains an optional
analysis/export utility, not the Editor editing contract.

## Local runtime

- Backend: FunASR 1.3.14
- Default model: `iic/SenseVoiceSmall`
- Cache: ModelScope local model cache
- Alignment request: `output_timestamp=true` and `pred_timestamp=true`
- Chinese output granularity: characters and punctuation are timed tokens;
  English spans may be whole words.

`status(model)` now reports ready only when both FunASR and that model snapshot
are locally available. `deploy(model)` installs runtime dependencies and
downloads/loads the selected model.

## Verified demo

The sample under `artifacts/asr-demo/short.wav` is local macOS speech synthesis.
SenseVoice returned 11 timed tokens over 2610 ms. The transcript was projected
at 30 fps into a 79-frame `talking-head.analysis` action at
`artifacts/asr-demo/text-cut-action.json`.

The sample also illustrates why correction remains a review step: the model
recognized the final `齐` as `集`. Timing is useful and preserved, but ASR text
must not be treated as editorial truth.

`artifacts/asr-demo/filler-source.mp4` is a second real sample containing `嗯`.
SenseVoice's lexical timestamp covered only frames 26-28 and landed inside the
leading pause, while the following punctuation token covered the filler tail.
The planner therefore expands a deleted filler through its trailing punctuation
alignment range (frames 26-36 here), cleans the duplicate comma from caption
text, and renders `artifacts/asr-demo/filler-clean.mp4` as a new asset. A second
real ASR pass over the rendered file returns `大家好，我们现在开始测试。`,
confirming that `嗯` is gone. The ffprobe-validated result retains H.264 video
and AAC audio at 720x1280.

## Agent workflow

1. Ensure the Timeline primary track has a cached word-aligned transcript.
2. Run `clash timeline pull --timeline <id>`.
3. Read the emitted `*.transcript.json` word-to-frame table.
4. Choose edit boundaries and modify `*.timeline.yaml` with normal file tools.
5. Run `clash timeline apply --timeline <id>`.
6. Preview, render, or pull again before the next edit.

## Remaining product work

- Per-asset source transcript mode for finding and reinserting unused material.
- Transcript correction revision history and bulk search.
- Speaker diarization review and speaker labels.
- A persistent model worker so repeated transcriptions do not reload the model.
- Confidence-aware correction queues and language-specific token grouping.
