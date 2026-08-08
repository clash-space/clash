# Video and Image Skill Market Research

This document summarizes the first pass of external research and maps it into
first-party Clash skills under `skills/video-production/`.

> Current execution boundary (2026-08-07): this is a research record, not an
> alternate renderer menu. Motion graphics have one supported product path:
> `Remotion TSX -> Canvas remotion-component -> Timeline sourceNodeId -> Timeline render`.
> Earlier experiments based on a separate spec, generated web preview, snapshot
> exporter, or overlay-video exporter are retired and are not agent-facing
> product contracts.

## External Patterns Worth Migrating

| Source                                                                                                                          | What to migrate                                                                             | Clash interpretation                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [OpenMontage](https://github.com/calesthio/OpenMontage)                                                                         | Pipeline-first agentic video production, stage directors, broad tool/skill map              | `agentic-video-architecture`: manifest, stage gates, artifacts, black-box QA                                       |
| [HyperFrames](https://github.com/heygen-com/hyperframes)                                                                        | Agent-readable routing, deterministic motion practice, and domain skills                    | Creative and seek-safe authoring lessons only; Clash components still use the native Remotion/Canvas/Timeline path |
| [CutScript](https://github.com/DataAnts-AI/CutScript)                                                                           | Word-level transcript editing, filler removal, captions, FFmpeg export                      | `talking-head-text-cut`: ASR words, filler/tone-particle analysis, cut plan                                        |
| [auto-editor](https://github.com/WyattBlue/auto-editor)                                                                         | Loudness/motion-based automatic cuts, margins, editor exports                               | Talking-head first pass plus optional NLE handoff/export formats                                                   |
| [BeatSync Engine](https://github.com/Merserk/BeatSync-Engine)                                                                   | Beat grid, energy/rhythm, section detection, source video visual library                    | `music-video-beat-editing`: `analysis/audio/*` and `analysis/video/visual-moments.json`                            |
| [Montage AI](https://github.com/mfahsold/montage-ai)                                                                            | Local-first rough cuts, beat sync, scene analysis, OTIO/EDL/CSV export                      | Asset metadata and export validation requirements                                                                  |
| [Awesome Multi-Image Generation](https://github.com/ATH-MaaS/Awesome-Multi-Image-Generation)                                    | Multi-view, character, temporal, semantic consistency categories                            | `image-storyboard-consistency`: reference sheets and consistency QA                                                |
| [StoryMaker](https://github.com/FireRedTeam/StoryMaker) / [PhotoMaker](https://github.com/TencentARC/PhotoMaker) class projects | Character identity and personalized image generation                                        | Character/product reference sheet workflows                                                                        |
| [Vex](https://github.com/AKMessi/vex)                                                                                           | Terminal video agent, safe working copy, transcript intelligence, HyperFrames/Manim routing | Reinforces that LLM chooses tools while project state owns truth                                                   |
| [mcp-video](https://github.com/KyaniteLabs/mcp-video)                                                                           | Guardrailed MCP video editing server with FFmpeg/HyperFrames-style tool boundary            | Potential future local tool server, but product state still needs Clash CAS                                        |
| [cut-clean](https://github.com/dennisrongo/cut-clean)                                                                           | Local filler-word and silence removal                                                       | Talking-head analysis/cut-plan skill, not a whole product architecture                                             |
| [vibeframe](https://github.com/vericontext/vibeframe)                                                                           | CLI-first AI-native video editor with project files, profiles, characters, dry runs         | Confirms repo-hosted project file roles and dry-run workflows                                                      |

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
- Keep high-level render intent separate from implementation details, while
  exposing only the native Remotion component and Timeline renderer for
  editable motion graphics.
- Treat public references as analysis-only unless rights are recorded.
- Use deterministic fixture E2E before live provider E2E.

## What Was Not Directly Migrated

- OpenMontage's full pipeline/tool library is too broad to copy wholesale. The
  migrated part is the architecture: manifest, stage director, self-review, and
  approval gates.
- HyperFrames does not become a Clash runtime. Only its creative organization
  and seek-safe deterministic-motion lessons are relevant; executable components
  stay as Remotion TSX in Canvas and render through Timeline.
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
- `render.export-validation`: decode/duration/dimension checks for final Timeline
  videos, plus source Timeline revision and resolved Canvas-component lineage.
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
- Motion-graphics overlays use the hardened Remotion component path. Remaining
  closure work is final-video validation, sampled-frame evidence, and exact
  readback of the Canvas source node and Timeline revision used by the renderer.
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

## Current Product Contracts

The first pass was mostly skill/registry research. The executable motion path is
now deliberately narrower:

- a default-exported single-file Remotion TSX module is the editable source;
- `clash canvas add --type remotion` (or the peer Canvas MCP operation) stores
  the exact source in a distinct `remotion-component` node;
- the Editor compiles that node for preview;
- a Timeline composition uses `runtime: remotion` and the stable Canvas node ID
  as `sourceNodeId`, without embedding a source snapshot;
- `clash timeline render` (or the peer Timeline MCP operation) produces final
  media from the persisted Timeline and the latest source on that node;
- read-before-write and CAS apply to Canvas and Timeline mutations, while the
  completed Asset and its source Timeline revision provide delivery evidence.

`examples/remotion/lower-third/` demonstrates this contract with `LowerThird.tsx` and
a `sourceNodeId`-linked Timeline YAML snippet. Other production-action examples
remain local metadata/planning fixtures and do not establish another motion
renderer.

This still does not mean Clash can fully render/export every researched
workflow. Real analysis backends, durable product readback, referenced-media
validation, and provider execution remain separate capability questions.

## Product Boundary

These skills are portable local workflows first. They are allowed to create and
edit local files in an agent/user-owned workspace, but they must not write
protected collaborative project state directly. They produce plans, analyses,
assets, and timeline projections. Product state changes enter Clash through
CLI/host APIs with CAS or explicit copy-on-write commands.
