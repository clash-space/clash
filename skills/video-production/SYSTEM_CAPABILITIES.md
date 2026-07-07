# Video Production System Capabilities

These are Clash-native product capabilities used for managed execution. A skill
can still run as a portable local file/artifact workflow before every capability
exists; the registry labels the gap so agents do not over-claim what Clash can
automate, apply, or verify inside the collaborative project state.

In this model, the skill owns workflow instructions, input/output artifact
contracts, QA criteria, and license constraints. Clash owns collaboration and
management: asset registration, metadata fill, provenance, review gates,
timeline CAS apply, and canvas/timeline projections.

## Available Or Partial

- `media.asset-registry`: partially available through existing asset nodes,
  generation records, local `assets/manifest.json`, MG snapshot/video export
  asset entries, and storyboard panel asset registration; needs SQLite-backed
  rows and canvas node mappings.
- `timeline.cas-projection`: partially available for timeline/text projections.
- `render.export-validation`: partially available through render-server smoke
  tests, deterministic MG SVG snapshot export manifests, and local MG WebM/MP4
  video exports validated by ffprobe for codec, dimensions, duration, VP9
  `alpha_mode`, and decoded alpha-plane pixel sampling on transparent WebM
  exports. TVC delivery validation can also consume ffprobe media probes for
  rendered variants; full render-server/provider export and broader
  referenced-media validation remain missing.
- `audio.word-timestamps`: partially available through `clash production
  plan-text-cut`, which records existing ASR transcript provenance on
  `talking-head.analysis` metadata: source path/hash, backend/model, language,
  word count, and optional confidence/speaker fields. `clash production
  apply-metadata` also writes a readable
  `clash.talking-head.asr-transcript.projection` under
  `projections/transcripts`. Executing ASR backends, transcript correction UI,
  diarization review, and durable transcript storage are still missing.
- `render.remotion-composition`: partially available through Remotion packages,
  render-server, and preview rendering for structural `composition`, `caption`,
  and `derived-overlay` timeline items. The preview keeps structural item types
  when hydrating backing asset rows, exposes inspectable DOM attributes for
  caption cue ids, MG composition ids, and derived overlay source/derived asset
  lineage. Non-HTML React/Remotion composition timeline items are accepted only
  after a local `renderedAssetPath` exists for preview; raw React source paths
  alone are rejected by timeline validation. Already rendered Remotion assets
  can be registered in `assets/manifest.json` and projected into timeline via
  `clash production project-composition-timeline`. Full managed render-server
  parity is still missing.
- `render.composition-router`: partially available through `clash production
  plan-composition-route`, which reads a portable composition route request and
  writes a `clash.render.composition-route` plan with selected runtime,
  validation plan, decision log, and `fallbackUsed: false`. It blocks React/
  timeline-editor routes when Remotion is unavailable instead of silently
  falling back to HTML or FFmpeg, and requires React/Remotion timeline items to
  be backed by a local rendered preview asset before apply. `clash production
  project-composition-timeline` turns a planned Remotion route plus registered
  rendered asset into a CAS-required composition timeline projection. Host
  runtime probing and Remotion/Manim execution orchestration are still missing.
- `review.stage-gates`: partially available through `clash production
  plan-review-gate` and `clash production approve-review-gate`, which write
  local `clash.review.stage-gate` artifacts plus path-bound hash lock sidecars.
  Required artifacts are checked as local project paths, gates stay blocked
  until missing artifacts exist, and explicit approval/reject decisions are
  stale-write and wrong-file protected. Durable project DB storage, multi-user
  review UI, cloud sync, and stage graph orchestration are still missing.
- `workflow.dry-run-cost-gate`: partially available through `clash production
  plan-dry-run-cost-gate`, which reads a local provider/runtime request and
  writes a `clash.workflow.dry-run-cost-gate` artifact with availability,
  estimated cost/time, max-cost blocking, `fallbackUsed: false`, and rejected
  fallback records. It never executes generation, download, render, or provider
  calls. Live provider probing, BYO OAuth/key checks, quota/rate-limit checks,
  and cloud policy sync are still missing.
- `workflow.pipeline-validation`: partially available through
  `clash production validate-pipeline-manifest`, which validates
  `pipeline.manifest.json` artifact coverage for action, metadata, asset,
  projection, review-gate, and export outputs, requires projection artifacts to
  declare `casRequired: true`, checks local file presence, and writes
  `clash.production.pipeline-validation` reports. Durable stage graph
  orchestration, UI blocking, and cloud/project DB persistence remain missing.
- `analysis.backend-benchmark`: partially available through `clash production
  plan-analysis-benchmark` plus `clash production apply-metadata`, which compare
  existing local backend result files against deterministic metric thresholds,
  write `analysis.backend-benchmark` metadata, select the best passing backend,
  emit `clash.analysis.backend-benchmark` reports, and project
  `clash.analysis.backend-benchmark.projection` under `projections/analysis`.
  It never executes ASR, beat, image, VLM, or provider backends; benchmark
  execution orchestration, larger fixture suites, and backend-specific runners
  remain missing.
- `legal.oss-license-ledger`: partially available through skill marketplace
  `thirdPartyReferences`; needs dependency scanning, NOTICE generation, and
  explicit review workflow before vendoring third-party code, models, prompts,
  or templates.
- `render.html-composition`: partially available through first-party MG specs,
  deterministic frame evaluation, self-contained seekable HTML previews with
  browser-verifiable `data-current-frame` state and `clash-mg-frame` events,
  `clash production render-mg` projection generation with explicit
  `clash timeline apply` CAS boundary metadata and lock sidecar paths,
  `clash production export-mg-snapshots` SVG asset export,
  `clash production export-mg-video` local WebM/MP4 export, timeline
  `composition` items, VP9 alpha-mode verification, decoded alpha-plane pixel
  sampling, and Remotion preview rendering with inspectable composition DOM
  contracts. MG manifests declare the renderer as Clash first-party, MIT
  licensed, external-runtime-free, and no copied third-party code, with
  HyperFrames recorded only as a research reference; needs richer renderer
  parity.
- `caption.retime-and-render`: partially available through structured caption
  items with cue word references, source frame ranges, source-to-output maps,
  subtitle-track validation, renderer preview, talking-head metadata
  projection, and `clash production export-captions` SRT/VTT/ASS sidecar export
  from caption timeline YAML. `clash production project-caption-overlay` can
  also project caption-only subtitle timeline views with a
  `clash.caption.timeline-overlay` manifest, Remotion preview renderer metadata,
  and an explicit `clash timeline apply` CAS boundary.
  `clash production export-caption-burn` writes an ASS sidecar, FFmpeg plan,
  copy-on-write `clash.caption.burn-in-export` package, and derived
  `caption-burn-plan` asset entry with source timeline id, revision id/status,
  and hash provenance; with `--render` it can invoke FFmpeg to create the
  burned-in video asset. Full retime UI, batch review, applied Loro revision
  pinning, and visual caption QA are still missing.
- `audio.beat-grid`: partially available as metadata schema, timeline edit
  hints, section cut hints, and `clash production analyze-audio-beats` for
  local 16-bit PCM WAV files, including `energyCurve` points, cut-density
  hints, semantic section labels, review confidence, and `semanticSource`
  metadata. `clash production project-mv-beat-cuts` can project beat sections
  plus visual clip assets into a CAS-required MV timeline YAML view and manifest
  while preserving section semantic metadata; non-WAV backend support and robust
  multi-tempo analysis are still missing.
- `audio.section-analysis`: partially available as 4-beat bar sections from the
  local PCM WAV analyzer with energy, novelty, impact, `cutDensity`, semantic
  intro/verse/chorus/drop/buildup/outro-style labels, review confidence, and
  `semanticSource` metadata; compressed-audio backends, multi-tempo boundaries,
  and model-grade verse/chorus detection remain missing.
- `audio.stem-separation`: partially available through `clash production
  plan-audio-stem-separation` plus `clash production apply-metadata`, which
  register existing local vocal/instrumental/drum/bass/other stem files, store
  stem path/hash/backend/model lineage, project
  `clash.audio.stem-separation.projection` under `projections/audio`, and
  attach per-stem `audio.stem` metadata as local `audio-stem` assets. It does
  not execute Demucs/UVR/separation backends; backend runners, vocal quality
  scoring, and review UI remain missing.
- `audio.lyrics-alignment`: partially available through `clash production
  plan-lyrics-alignment`, which maps lyric lines onto beat-analysis sections,
  writes `audio.lyrics-alignment` metadata to the audio asset, emits
  `projections/lyrics/*.lyrics-alignment.json`, and projects a structured
  `caption` timeline at `projections/timelines/*.lyrics.caption.timeline.yaml`.
  This is a deterministic beat-section heuristic; true vocal/phoneme forced
  alignment, word/syllable timing, stem-assisted confidence, and review UI are
  still missing.
- `video.text-cut-plan`: partially available as talking-head transcript/cut
  metadata with ASR transcript provenance, `clash production plan-text-cut`,
  caption projection, and
  `clash production export-text-cut-media`, which writes a non-destructive cut
  package, FFmpeg concat/trim plan, reviewRanges for pending human/agent
  decisions, optional rendered video asset only when the plan has no pending
  review cuts, ffprobe validation, and manifest lineage. `clash production
  export-captions` can write SRT/VTT/ASS sidecars from the caption timeline view,
  `clash production project-caption-overlay` can write a CAS-required caption
  overlay timeline projection for preview/apply, and `clash production
  export-caption-burn` can write a copy-on-write caption-burn package plus
  optional FFmpeg render with source timeline id, revision id/status, and hash
  provenance. `clash production export-timeline-handoff` can write a CSV
  handoff for external NLE review. It still needs review UI, crossfades, batch
  operations, applied Loro revision pinning, and OTIO/EDL handoff.
- `audio.silence-analysis`: partially available as word-gap silence detection
  in `clash production plan-text-cut`; needs waveform VAD/RMS thresholds,
  margins, smoothing, and review recommendations.
- `audio.filler-analysis`: partially available as configured filler-word,
  tone-particle, and adjacent-repeat detection in `clash production
  plan-text-cut`; needs semantic discourse-marker confidence and broader
  false-start analysis.
- `media.analysis-store`: partially available as shared metadata-fill schemas;
  needs project-file/SQLite storage and host apply API.
- `media.rights-ledger`: partially available as reference rights metadata,
  remix guard, and `projections/rights/*.rights-ledger.json`; needs durable
  storage, attribution export, and legal review workflow.
- `provenance.content-credentials`: partially available through
  `clash production plan-content-credentials` plus
  `clash production apply-metadata`, which register a local unsigned or
  externally signed content-credentials manifest, compute target/ingredient/
  optional C2PA manifest hashes, write `provenance.content-credentials`
  metadata, and project `clash.provenance.content-credentials.projection` under
  `projections/provenance`. It does not sign C2PA manifests or create content
  credentials; c2patool integration, signing identity, and export embedding
  remain separate system work.
- `video.reference-ingest`: partially available as metadata-only
  `clash production plan-reference-review` for source URL, rights, shot notes,
  non-copying QA, rights-ledger projection, and analysis-only
  `clash.reference.shot-analysis.projection` files. `clash production
  plan-reference-download` can also produce an explicit yt-dlp command plan with
  rights metadata, raw-reference quarantine, and a blocked-by-default
  `--allow-download` gate; `clash production execute-reference-download` can
  run an allowed plan with a local yt-dlp-compatible runner, reject tampered
  executables and yt-dlp local-execution flags such as `--exec`, write a
  download receipt, and register `reference.download` metadata on a quarantined
  raw reference asset. Browser capture, cookie/session handling, and platform
  terms review remain missing.
- `video.reference-download`: partially available through
  `clash production plan-reference-download`, which writes a
  `clash.reference.download-plan` manifest, and
  `clash production execute-reference-download`, which explicitly runs an
  allowed plan with a local yt-dlp-compatible runner, writes a
  `clash.reference.download-receipt`, and registers `reference.download`
  metadata on a quarantined raw reference asset. It requires explicit
  `--allow-download`, quarantines raw references under `references/raw/*`, and
  marks final export as disallowed unless rights permit it. Execution rejects
  plan tampering where `downloadCommand[0]` is not `yt-dlp` and rejects yt-dlp
  arguments that can execute local commands. Browser capture, cookie/session
  handling, and platform terms review are still missing.
- `video.shot-analysis`: partially available as reference shot metadata schema
  plus `clash production apply-metadata` projection of local/agent shot notes
  into `projections/references/*.shot-analysis.json` with `analysisOnly: true`,
  `mediaCopied: false`, and rights-ledger allowed/prohibited uses. Automatic
  detector and visual QA backend are still missing.
- `video.visual-moment-library`: partially available through `clash production
  plan-visual-moments`, which converts agent or external analysis candidate
  ranges into `video.visual-moments` metadata on the source video asset and
  writes `projections/visual-moments/*.visual-moments.json` with ranked
  `recommendedClips` for MV/TVC planning. It does not copy frames and does not
  mutate timeline/canvas. Automatic scene detection, optical-flow/VLM scoring,
  semantic tagging, and rights-aware raw reference extraction remain missing.
- `video.noncopying-qa`: partially available through
  `clash production plan-reference-noncopying-qa`, which writes a structured QA
  report and reference metadata-fill action from reference shot analysis plus a
  proposed treatment without downloading or copying source media. It currently
  checks raw reference asset paths and text/tag-level structural similarity.
  `clash production verify-reference-isolation` can also verify a final timeline
  projection against `assets/manifest.json` and block direct use of unlicensed
  quarantined `reference.download` assets or `references/raw/*` paths. Video/audio
  fingerprinting, creator-likeness checks, and review UI are still missing.
- `ad.delivery-spec`: partially available through `clash production
  plan-ad-delivery-spec`, which writes platform variants, durations, aspect
  ratio, safe zones, subtitle/loudness expectations, and delivery checklist
  metadata into an asset plus `projections/delivery/*.delivery-spec.json`.
- `ad.delivery-export-validation`: partially available through
  `clash production extract-ad-visual-frames`, which uses local ffmpeg to
  extract rendered ad video frames into PPM samples and writes a
  `clash.ad.visual-frame-extraction` manifest; `clash production
  analyze-ad-visual-pixels`, which reads local P3/P6 PPM frame samples and
  emits `clash.ad.visual-pixel-evidence` for packshot color coverage,
  end-card readability, and final-frame mean RGB diff checks;
  `clash production plan-ad-visual-qa`, which normalizes local analyzer or
  human review evidence into portable `clash.ad.visual-qa` reports plus
  `ad.visual-qa` metadata without executing OCR/logo/pixel backends, and
  `clash production validate-ad-delivery-export`, which writes
  `qa/delivery/*.validation.json` receipts for rendered variants by checking
  delivery variant, video/audio tracks, dimensions, aspect ratio, fps,
  duration, subtitles, safe zones, packshot, end-card, disclaimer, and rights
  evidence from ffprobe/probe JSON plus visual QA reports. Automatic loudness,
  OCR/logo detection, and direct PNG/JPEG image decoding backends remain
  missing.
- `ad.packshot-end-card`: partially available through the same delivery-spec
  action, which records packshot asset/frame requirements, CTA, disclaimer, QR
  requirement, and end-card duration. `extract-ad-visual-frames` can extract
  rendered video frames into local PPM samples, `analyze-ad-visual-pixels` can
  produce local PPM pixel evidence for packshot color coverage, end-card
  samples, and final-frame holds; `plan-ad-visual-qa` can record packshot, logo,
  disclaimer, CTA, and final-frame evidence from local analyzers or human
  review; `validate-ad-delivery-export` can require the resulting visual QA
  report. Automatic OCR/logo detector backends and richer image decoding are
  still missing.
- `image.reference-sheets`: partially available through character reference
  packs, semantic reference roles, and storyboard `referenceViews`.
  `clash production plan-storyboard-review` plus
  `clash production apply-metadata` now register each declared character view
  as a `character-reference-sheet` asset with
  `image.character-reference-sheet` metadata, locked identity-reference usage,
  and copy-on-write requirements. It still needs automatic generation,
  embedding/OCR/visual QA backends, and immutable reference-sheet UI.
- `image.semantic-reference-roles`: partially available through
  `clash production plan-reference-roles` plus `clash production apply-metadata`,
  which write `image.semantic-reference-roles` metadata, project
  `clash.image.semantic-reference-roles.projection`, and attach individual
  `image.semantic-reference-role` metadata to reference assets. Supported roles
  include identity front/side/back/expression, scene plate, style frame,
  logo lock, and product packshot, with copy-on-write requirements. Automatic
  role detection, OCR/logo verification, and immutable reference-sheet UI are
  still missing.
- `image.product-logo-qa`: partially available through `clash production
  plan-product-logo-qa` plus `clash production apply-metadata`, which consume
  semantic `logo-lock` and `product-packshot` roles plus agent/local analyzer
  visual or OCR evidence, write `image.product-logo-qa` metadata, and project
  `clash.image.product-logo-qa.projection` under `projections/qa`. Required
  locked reference assets remain copy-on-write, failed evidence blocks release,
  and missing per-role evidence fails closed. Automatic OCR/logo detection,
  color sampling, material verification, and review UI remain missing.
- `image.embedding-store`: partially available through `clash production
  plan-image-embedding-store` plus `clash production apply-metadata`, which
  register existing local image embedding vector files, verify vector
  dimensions, store vector path/hash/model/distance metric metadata, project
  `clash.image.embedding-store.projection` under `projections/embeddings`, and
  attach per-asset `image.embedding` metadata for identity/product/scene/style/
  logo baselines. It does not execute embedding models; backend runners,
  similarity search indexes, threshold calibration, and review UI remain
  missing.
- `image.comfyui-runner`: partially available through `clash production
  plan-comfyui-workflow` plus `clash production apply-metadata`, which register
  a pinned local ComfyUI workflow file, compute workflow/output hashes, record
  model and custom-node lineage, preserve input slot mapping, project
  `clash.image.comfyui-runner.projection` under `projections/image`, and attach
  per-output `image.comfyui-output` metadata as local assets. It does not
  execute ComfyUI, install models/nodes, manage queues, or validate generated
  pixels; host execution and visual QA remain separate system work.
- `image.storyboard-consistency`: partially available as storyboard metadata
  schema, CLI planner, storyboard projection, storyboard panel asset
  registration, character reference-sheet asset registration from
  `characters[].referenceViews`, and
  `clash production plan-storyboard-consistency-qa`, which writes a
  deterministic QA report plus metadata-fill action for required views, panel
  references, asset paths, and per-panel consistency thresholds.
  `clash production project-storyboard-timeline` can project approved panel
  assets into a CAS-required image timeline view, and `clash production
  verify-storyboard-timeline` can verify panel coverage, timeline item coverage,
  consistency thresholds, local asset paths, and fresh-pull CAS before apply.
  It still needs embedding/OCR/logo/style consistency backends.
- `storyboard.cas-projection`: partially available through
  `clash production project-storyboard-prompt-pack` and
  `clash production apply-storyboard-prompt-pack`, which turn storyboard
  metadata into an agent-editable prompt-pack file plus lock sidecar, then
  explicitly apply reviewed edits into `projections/storyboards/*` with stale
  write rejection. `clash production replace-storyboard-prompt-pack` uses the
  same lock as read proof to create a versioned copy-on-write prompt-pack
  projection without moving existing downstream references. Storyboard panel
  timeline projection is also CAS-required.
  Editable storyboard host UI/apply integration is still missing.
- `workflow.production-action-runner`: partially available through
  repo-hosted marketplace action contracts for representative local CLI
  production primitives, plus `clash production apply-metadata`,
  `clash production render-mg`, and
  production planners/exporters such as `plan-composition-route`,
  `plan-review-gate`, `approve-review-gate`, `plan-dry-run-cost-gate`,
  `export-mg-snapshots`, `plan-text-cut`, `export-text-cut-media`,
  `export-mg-video`, `project-derived-overlay`,
  `export-captions`, `project-caption-overlay`, `export-caption-burn`, `export-timeline-handoff`, `analyze-audio-beats`, `plan-lyrics-alignment`,
  `plan-visual-moments`, `project-mv-beat-cuts`, `plan-ad-delivery-spec`,
  `extract-ad-visual-frames`, `analyze-ad-visual-pixels`, `plan-ad-visual-qa`,
  `validate-ad-delivery-export`, `plan-reference-review`, `plan-reference-download`,
  `execute-reference-download`,
  `plan-reference-noncopying-qa`, `plan-product-logo-qa`,
  `plan-analysis-benchmark`, `plan-image-embedding-store`,
  `plan-audio-stem-separation`, `plan-comfyui-workflow`,
  `plan-content-credentials`,
  `plan-storyboard-consistency-qa`,
  `project-storyboard-prompt-pack`, `apply-storyboard-prompt-pack`,
  `replace-storyboard-prompt-pack`, and `project-storyboard-timeline`, which apply action/spec/media/transcript/
  storyboard JSON into local metadata, assets, and `projections/*` without
  mutating canvas; MG, derived-overlay, caption overlay, MV beat-cut,
  storyboard prompt-pack, and storyboard timeline projections now carry explicit
  CAS apply boundaries,
  product/logo QA fails closed on locked reference evidence, analysis backend
  benchmarks never execute backends, image embedding stores register existing
  vector files without executing models, audio stem separation registers
  existing stem files without executing separation backends, ComfyUI workflow
  plans register pinned workflow/output lineage without executing ComfyUI, ad
  visual frame extraction uses explicit local ffmpeg and writes a manifest, ad
  visual pixel analysis reads only local PPM frame samples, ad visual QA plans
  never execute OCR/logo/pixel analysis backends, and content
  credential plans register unsigned/external manifests without signing C2PA;
  review gates carry path-bound hash lock sidecars.
  It still needs provider execution,
  durable project DB integration, multi-user review UI, and managed timeline
  apply orchestration.
- `media.copy-on-write`: partially available at the timeline view layer through
  `derived-overlay` items that record `sourceAssetId`, `derivedAssetId`,
  derivation metadata, local preview paths, and an optional `assetId` that must
  match `derivedAssetId` when present. `clash production
  project-derived-overlay` can project an existing derived asset into a
  CAS-required timeline view without minting a fake lock; Remotion preview
  preserves `derived-overlay` structure while resolving the backing asset and
  exposes source/derived lineage as inspectable DOM attributes. Text-cut media
  export writes a new video asset from a source asset without modifying the
  source. It still needs broader media derivation commands and immutable asset
  registry enforcement.
- `timeline.nle-handoff`: partially available through
  `clash production export-timeline-handoff`, which exports timeline YAML
  views to CSV rows with track/item ids, item type, frame ranges, timecodes,
  asset/source paths, and notes plus a `clash.timeline.nle-handoff` manifest.
  OTIO/EDL export and richer NLE round-trip import remain missing.

## Remaining V1 Hardening

- `audio.section-analysis`: multi-tempo section boundaries, compressed-audio
  support, and model-grade verse/chorus/drop detection beyond the local
  bar-level RMS heuristic.
- `ad.visual-analysis-backends`: automatic product lockup, logo/OCR,
  disclaimer visibility, and final-frame pixel analyzers. Portable visual QA
  evidence/report normalization exists; the analyzers themselves do not.
