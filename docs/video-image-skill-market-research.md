# Video and Image Skill Market Research

This document summarizes the first pass of external research and maps it into
first-party Clash skills under `skills/video-production/`.

## External Patterns Worth Migrating

| Source | What to migrate | Clash interpretation |
| --- | --- | --- |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | Pipeline-first agentic video production, stage directors, broad tool/skill map | `agentic-video-architecture`: manifest, stage gates, artifacts, black-box QA |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Agent-readable video router plus HTML/CSS media compositions and domain skills | `motion-graphics-overlays`: HTML/Remotion composition layer for MG and captions |
| [CutScript](https://github.com/DataAnts-AI/CutScript) | Word-level transcript editing, filler removal, captions, FFmpeg export | `talking-head-text-cut`: ASR words, filler/tone-particle analysis, cut plan |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | Loudness/motion-based automatic cuts, margins, editor exports | Talking-head first pass plus optional NLE handoff/export formats |
| [BeatSync Engine](https://github.com/Merserk/BeatSync-Engine) | Beat grid, energy/rhythm, section detection, source video visual library | `music-video-beat-editing`: `analysis/audio/*` and `analysis/video/visual-moments.json` |
| [Montage AI](https://github.com/mfahsold/montage-ai) | Local-first rough cuts, beat sync, scene analysis, OTIO/EDL/CSV export | Asset metadata and export validation requirements |
| [Awesome Multi-Image Generation](https://github.com/ATH-MaaS/Awesome-Multi-Image-Generation) | Multi-view, character, temporal, semantic consistency categories | `image-storyboard-consistency`: reference sheets and consistency QA |
| [StoryMaker](https://github.com/FireRedTeam/StoryMaker) / [PhotoMaker](https://github.com/TencentARC/PhotoMaker) class projects | Character identity and personalized image generation | Character/product reference sheet workflows |
| [Vex](https://github.com/AKMessi/vex) | Terminal video agent, safe working copy, transcript intelligence, HyperFrames/Manim routing | Reinforces that LLM chooses tools while project state owns truth |
| [mcp-video](https://github.com/KyaniteLabs/mcp-video) | Guardrailed MCP video editing server with FFmpeg/HyperFrames-style tool boundary | Potential future local tool server, but product state still needs Clash CAS |
| [cut-clean](https://github.com/dennisrongo/cut-clean) | Local filler-word and silence removal | Talking-head analysis/cut-plan skill, not a whole product architecture |
| [vibeframe](https://github.com/vericontext/vibeframe) | CLI-first AI-native video editor with project files, profiles, characters, dry runs | Confirms repo-hosted project file roles and dry-run workflows |

## Open-Source License Boundary

This pass migrates architecture patterns, artifact schemas, and skill
instructions. It does not vendor code, model weights, prompts, media assets, or
project templates from the researched projects.

`skills/registry.json` now includes `thirdPartyReferences` with source URL,
license, license source, allowed usage, and integration policy. The conservative
rules are:

- AGPL projects such as OpenMontage and BeatSync Engine are `research-only`
  unless we explicitly accept AGPL obligations or isolate them as
  user-installed tools.
- Noncommercial or source-available projects such as Montage AI and Vex are
  `research-only` for commercial product work unless a separate license exists.
- `NOASSERTION`, custom, or model-dependent projects such as StoryMaker and
  PhotoMaker require license/model-weight/dataset review before integration.
- Permissive projects such as HyperFrames, CutScript, mcp-video, VibeFrame,
  WhisperX, librosa, and cut-clean still require attribution, license/NOTICE
  preservation, and dependency review before code reuse.
- yt-dlp-style ingestion remains a user-installed/tool-boundary workflow, and
  downloaded media rights are tracked separately in the project rights ledger.

## First-Party Skills Added

Architecture:

- `agentic-video-architecture`
- `asset-metadata-architecture`
- `pipeline-manifest-architecture`
- `project-file-contract`
- `copy-on-write-lineage`
- `composition-runtime-router`
- `video-release-checkpoint`
- `provider-budget-capability`

Detail workflows:

- `short-drama-production`
- `music-video-beat-editing`
- `talking-head-text-cut`
- `tvc-reference-remix`
- `image-storyboard-consistency`
- `motion-graphics-overlays`

Concrete stage skills:

- `image-character-reference-sheets`
- `audio-beat-analysis`
- `audio-transcript-cut-planning`
- `reference-video-ingest-analysis`
- `audio-lyrics-alignment`
- `visual-moment-library`
- `caption-retime-and-render`
- `ad-delivery-spec-pack`
- `packshot-end-card-builder`
- `reference-noncopying-qa`
- `hotspot-structure-remix`
- `image-consistency-qa`
- `product-logo-lock`

## Subagent Synthesis

Five subagents were used to split research by domain:

- Architecture: OpenMontage/HyperFrames/Vex/mcp-video/VibeFrame patterns.
- Talking-head: CutScript/auto-editor/cut-clean/WhisperX transcript editing.
- MV/audio: BeatSync Engine/Montage AI/librosa/Essentia/madmom style analysis.
- Image: StoryMaker/PhotoMaker/IP-Adapter/ComfyUI/image QA patterns.
- TVC/reference: yt-dlp-style ingest, rights ledgers, delivery specs, and
  non-copying QA.

The main merged conclusions:

- Keep Clash as the source of truth for collaborative product state; skills own
  portable workflow/artifact contracts, and local agents can work in their cwd
  before applying product state through product APIs with CAS.
- Treat production as staged artifacts: `brief`, `references`, `analysis`,
  `plans`, `assets`, `projections`, `reviews`, and `exports`.
- Add dry-run/cost gates before provider-heavy generation.
- Separate render intent from runtime; Remotion, HTML/HyperFrames-style, FFmpeg,
  Manim, and future renderers need an explicit router.
- Treat public references as analysis-only unless rights are recorded.
- Use deterministic fixture E2E before live provider E2E.

## What Was Not Directly Migrated

- OpenMontage's full pipeline/tool library is too broad to copy wholesale. The
  migrated part is the architecture: manifest, stage director, self-review, and
  approval gates.
- HyperFrames should not replace Clash's existing Remotion path immediately. The
  migrated part is an agent-friendly HTML composition capability for MG overlays
  and deterministic preview/render.
- CutScript/auto-editor are product-sized apps. The migrated part is their
  transcript/silence/filler intermediate representation and non-destructive cut
  plan.
- BeatSync Engine is Windows-portable and GPU-heavy. The migrated part is the
  staged audio analysis contract, not its exact runtime.
- Image consistency projects depend on model/provider details. The migrated part
  is the asset pack and QA contract: identity sheet, three-view sheet, panel
  consistency, and reference locks.

## System Capabilities Still Needed

P0 for real production closure:

- `media.asset-registry`: stable asset rows/files for images, videos, audio,
  text, captions, references, overlays, and exports.
- `media.analysis-store`: first-class project storage for beat grids,
  transcripts, shot analysis, image consistency, and rights metadata.
- `timeline.cas-projection`: generalized CAS framework beyond current timeline
  and text implementations.
- `render.export-validation`: decode/duration/dimension checks for final videos
  and overlay assets. MG video export now has ffprobe-backed codec, dimension,
  duration, and VP9 alpha-mode validation; alpha-plane pixel sampling and
  referenced-media validation remain.
- `workflow.dry-run-cost-gate`: provider availability, BYO key/OAuth, and max
  cost checks before generation.
- `media.copy-on-write`: trims, caption burns, crops, denoise, and remix produce
  derived assets with parent lineage.

Workflow-specific:

- Short drama needs `image.reference-sheets` and
  `image.storyboard-consistency`.
  The current implementation can package character three-view references,
  scenes, and panels into storyboard metadata/projections and registers generated
  panel assets when panels include local paths. It does not generate images or
  run embedding/OCR consistency QA.
- MV needs `audio.beat-grid`, `audio.section-analysis`,
  `audio.lyrics-alignment`, `video.visual-moment-library`, and optionally
  `audio.stem-separation`.
  The current implementation has a lightweight local PCM WAV beat detector that
  emits beat metadata actions, timeline hints, bar sections,
  energy/novelty/impact curves, and section cut-density hints, but not semantic
  section labels, lyrics alignment, multi-tempo analysis, or non-WAV decode.
- 口播 needs `audio.word-timestamps`, `audio.filler-analysis`, and
  `audio.silence-analysis`, `video.text-cut-plan`, and
  `caption.retime-and-render`.
  The current implementation covers configured filler/tone-particle, adjacent
  repeat, word-gap silence planning from existing word timestamps, caption
  projection, and a non-destructive FFmpeg-backed `export-text-cut-media` path
  that writes a cut package and optional ffprobe-validated clean video asset. It
  does not yet cover full ASR, VAD/RMS, semantic discourse-marker scoring, broader
  false-start analysis, crossfades, batch review, or full NLE handoff.
- TVC/hotspot remix needs `video.reference-ingest`, `video.shot-analysis`, and
  `media.rights-ledger`, plus `video.noncopying-qa`, `ad.delivery-spec`, and
  `ad.packshot-end-card`.
  The current implementation has metadata-only reference review with rights,
  shot notes, non-copying QA placeholders, and an agent-readable rights ledger;
  it does not download, copy, or remix public source media.
- MG overlays need `render.html-composition` or a hardened Remotion composition
  path. The current implementation can export deterministic SVG snapshot assets
  and local WebM/MP4 overlay videos from first-party MG specs, but alpha-plane
  pixel sampling and richer renderer parity remain missing.
- Image packs need semantic reference roles, image consistency QA, product/logo
  OCR checks, ComfyUI/local runner contracts, and storyboard CAS projections.

## Test Coverage Added

- `skills/skill-market.test.mjs` validates the first-party registry, marketplace
  semantics, every `SKILL.md` path/frontmatter, Clash-native automation
  capability bindings, and eval coverage.
- `apps/api-cf/src/routes/marketplace.test.ts` validates first-party registry
  serving, remote community merge, remote failure fallback, and duplicate-id
  protection.
- `skills/video-production/evals/evals.json` gives each skill at least one
  realistic eval prompt and expected output for future skill-quality evaluation.
- `skills/video-production-e2e.test.mjs` runs a deterministic artifact E2E over
  short drama, MV, 口播, TVC/reference, and image workflows.
- `skills/video-production/e2e/video-production-e2e.mjs` emits representative
  artifacts and validates them against local schemas: pipeline manifest,
  character reference pack, beat grid, lyrics alignment, visual moments,
  transcript cut plan, talking-head media cut export, reference video analysis,
  and image consistency report.

## Product Contracts Added After Runtime Challenge

The first pass was mostly skill/registry work. The follow-up implementation
adds concrete contracts and preview/runtime support:

- `packages/shared-types/src/mg-composition.ts`: first-party MG composition
  spec, deterministic frame evaluation, self-contained HTML preview generator,
  and timeline `composition` manifest builder.
- `packages/remotion-core/src/types/index.ts`: timeline now has first-class
  `composition`, `caption`, and `derived-overlay` items. Arbitrary remote
  component paths are rejected by semantics validation; derived overlays must
  preserve copy-on-write lineage.
- `packages/remotion-components/src/VideoComposition.tsx`: Remotion preview can
  render first-party HTML/MG composition specs, structured caption cues, and
  derived image/video overlays.
- `packages/shared-types/src/production-metadata.ts`: action -> metadata fill ->
  asset contracts for MV beat metadata, talking-head transcript/cuts/captions,
  reference-video rights/shot/non-copying metadata, and image storyboard
  consistency metadata.
- `packages/cli/src/commands/production.ts`: `clash production apply-metadata`
  applies local action JSON into `assets/manifest.json`, writes
  `projections/metadata/*`, and emits timeline/reference/storyboard projections
  without mutating canvas state. `clash production render-mg` turns an
  agent-authored MG `spec.json` into a self-contained HTML preview, overlay
  manifest, and timeline YAML projection, also without mutating canvas state.
  The manifest records the required `clash timeline pull/apply` boundary;
  cwd observation state supplies CAS implicitly and the skill does not mint
  write authority.
  `clash production export-mg-snapshots` exports deterministic SVG frames into
  `assets/overlays/*` and registers an `overlay-snapshot-sequence` asset in
  `assets/manifest.json`. `clash production export-mg-video` exports a playable
  local WebM/MP4 overlay, writes an adjacent export receipt, validates it with
  ffprobe, and registers an `overlay-video` asset in `assets/manifest.json`.
  `clash production plan-text-cut` turns word-level ASR JSON into a
  talking-head metadata-fill action with filler/tone-particle/repeat/silence
  cuts and caption cues carrying word ids and source frame ranges; applying
  that action emits a structured caption timeline projection with `wordRefs`
  and `sourceToOutputMap`. `clash production export-text-cut-media` turns the reviewed
  talking-head action into a media cut package, FFmpeg concat/trim plan, and
  optional ffprobe-validated rendered clean video asset registered in
  `assets/manifest.json`.
  `clash production analyze-audio-beats` turns local 16-bit PCM WAV into an MV
  beat metadata-fill action with BPM, beats, downbeats, 4-beat bar sections,
  energy/novelty/impact curves, and cut-density hints; applying that action
  emits beat timeline hints, energy curves, and section cut hints.
  `clash production plan-reference-review` turns a reference URL and optional
  shot notes into a rights/non-copying review action; applying that action writes
  metadata, reference review, and rights-ledger projections while staying
  metadata-only unless rights allow remixing.
  `clash production plan-storyboard-review` turns characters/scenes/panels JSON
  into short-drama/image storyboard metadata and projection files; applying the
  action also registers panel assets in `assets/manifest.json` when panel paths
  are present.
- `examples/mg/lower-third/`: a runnable lower-third MG fixture with editable
  `spec.json`, self-contained `index.html`, timeline manifest, and a README
  showing the `clash production render-mg` command.
- `examples/production-actions/`: local action fixtures for MV beat metadata,
  talking-head captions and text-cut planning, TVC/reference rights review, and
  short-drama/image storyboard metadata.

This still does not mean Clash can fully render/export every workflow. The
implementation intentionally marks the relevant capabilities as `partial` until
real analysis backends, durable project storage, alpha-plane pixel sampling,
referenced-media validation, and provider execution are complete. Canvas/timeline
mutation remains explicit through existing CAS apply commands such as
`clash timeline apply`.

## Product Boundary

These skills are portable local workflows first. They are allowed to create and
edit local files in an agent/user-owned workspace, but they must not write
protected collaborative project state directly. They produce plans, analyses,
assets, and timeline projections. Product state changes enter Clash through
CLI/host APIs with CAS or explicit copy-on-write commands.
