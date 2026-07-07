---
name: tvc-reference-remix
description: Use when producing TVC ads, brand commercials, product spots, launch videos, or recreating/remixing public hot videos with yt-dlp/reference ingestion, shot analysis, brand guardrails, legal constraints, and delivery specs.
---

# TVC and Reference Remix

Use this skill for production work that has brand, legal, platform, and delivery
constraints. It also covers hotspot/reference video复刻 when the source is
public and ingestion is allowed.

## Inputs

- brand brief, product claims, forbidden words;
- product images, logo, typography, colors, packshot;
- public reference URL if remixing;
- target specs: 6s, 15s, 30s, 9:16, 16:9, 1:1, platform safe areas;
- required disclaimers, approvals, rights.

## Pipeline

```text
brief/brand.md
brief/legal-constraints.json
references/source-ledger.json
analysis/reference-shots.json
analysis/brand-fit.json
storyboards/tvc-30s.json
plans/voiceover.json
plans/packshot.json
projections/timelines/tvc-30s.timeline.yaml
reviews/client-notes.md
exports/tvc-30s-16x9.mp4
exports/tvc-30s-9x16.mp4
```

## Reference Ingest Rules

Before download or remix decisions, create a controlled reference download plan.
The default plan is blocked unless the user and rights ledger explicitly allow
local capture:

```bash
clash production plan-reference-download \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --out references/downloads/asset-reference.download-plan.json \
  --json

clash production plan-reference-download \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --allow-download \
  --license analysis-only \
  --allowed-uses analysis-only,shot-breakdown \
  --out references/downloads/asset-reference.download-plan.json \
  --json
```

This writes a `clash.reference.download-plan` manifest with a yt-dlp command,
raw-reference quarantine path, rights metadata, and final-export guard. It does
not execute the network download by itself. If the reviewed plan is allowed,
run the execution step explicitly:

```bash
clash production execute-reference-download \
  --plan references/downloads/asset-reference.download-plan.json \
  --assets assets/manifest.json \
  --out references/downloads/asset-reference.download-receipt.json \
  --json
```

The receipt registers `reference.download` metadata on a quarantined raw
reference asset. This supports analysis and shot breakdown; it does not grant
permission to use raw frames, audio, logo, or likeness in final exports.

Use the metadata review planner before any remix decision:

```bash
clash production plan-reference-review \
  --source-url https://example.com/video \
  --target-asset asset-reference \
  --shots analysis/reference-shots.json \
  --out actions/reference-review.json \
  --json

clash production apply-metadata \
  --action actions/reference-review.json \
  --assets assets/manifest.json \
  --json
```

By default derivative and redistribution rights are false, so apply writes
metadata, review, rights-ledger, and analysis-only shot-analysis projections
only and does not create timeline media. The shot-analysis projection records
`mediaCopied: false` and inherits allowed/prohibited uses from the rights
ledger.

Before any reference-inspired treatment moves toward storyboard/timeline, run
the non-copying QA planner against the reference analysis and proposed shots:

```bash
clash production plan-reference-noncopying-qa \
  --reference analysis/reference-001.json \
  --proposal plans/proposed-tvc.json \
  --target-asset asset-reference \
  --out actions/reference-noncopying-qa.json \
  --report projections/references/reference-001.noncopying-qa.json \
  --json
```

The QA report is a gate, not permission to copy. `requires-review` means the
structure is close enough that the treatment needs human/legal review or a more
transformative rewrite.

Before any rendered timeline moves toward delivery validation or export, verify
that the final timeline does not directly reuse a quarantined raw reference
asset:

```bash
clash production verify-reference-isolation \
  --timeline projections/timelines/tvc-30s.timeline.yaml \
  --assets assets/manifest.json \
  --out qa/reference/tvc-30s.reference-isolation.json \
  --json
```

This reads only public project artifacts and writes
`clash.reference.isolation-verification`. If the timeline points at
`references/raw/*` or a `reference.download` asset without final export rights,
the report is `blocked`.

Before final export, create the platform delivery/packshot/end-card spec:

```bash
clash production plan-ad-delivery-spec \
  --target-asset asset-tvc \
  --brand "Brand Name" \
  --platforms tiktok,youtube-shorts \
  --durations 6,15,30 \
  --aspect 9:16 \
  --resolution 1080x1920 \
  --safe-zones 120,48,220,48 \
  --packshot-asset asset-packshot \
  --packshot-start 360 \
  --packshot-end 420 \
  --end-card-duration 90 \
  --cta "Shop now" \
  --disclaimer "Results vary." \
  --rights-ledger-asset asset-reference \
  --out actions/ad-delivery-spec.json \
  --json

clash production apply-metadata \
  --action actions/ad-delivery-spec.json \
  --assets assets/manifest.json \
  --json
```

This writes `ad.delivery-spec` metadata and
`projections/delivery/<asset>.delivery-spec.json`.

After rendering every platform variant, extract audited local PPM frame samples
from the rendered export:

```bash
clash production extract-ad-visual-frames \
  --target-asset asset-tvc \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --rendered exports/tiktok-15s.mp4 \
  --packshot-frame 390 \
  --end-card-frame 420 \
  --final-frame 449 \
  --out-dir analysis/visual/frames \
  --manifest analysis/visual/tiktok-15s.frame-extraction.json \
  --json
```

Then generate local pixel evidence from those samples:

```bash
clash production analyze-ad-visual-pixels \
  --target-asset asset-tvc \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --rendered-path exports/tiktok-15s.mp4 \
  --packshot-frame analysis/visual/frames/packshot.ppm \
  --packshot-color "#f04a2a" \
  --end-card-frame analysis/visual/frames/end-card.ppm \
  --final-frame analysis/visual/frames/final.ppm \
  --out analysis/visual/tiktok-15s.pixel-evidence.json \
  --json
```

Then normalize visual QA evidence:

```bash
clash production plan-ad-visual-qa \
  --target-asset asset-tvc \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --evidence analysis/visual/tiktok-15s.pixel-evidence.json \
  --out actions/ad-visual-qa.json \
  --report qa/visual/tiktok-15s.visual-qa.json \
  --json

clash production apply-metadata \
  --action actions/ad-visual-qa.json \
  --assets assets/manifest.json \
  --json
```

Then certify it with a receipt:

```bash
clash production validate-ad-delivery-export \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --rendered exports/tiktok-15s.mp4 \
  --probe analysis/probe/tiktok-15s.probe.json \
  --visual-report qa/visual/tiktok-15s.visual-qa.json \
  --out qa/delivery/tiktok-15s.validation.json \
  --json
```

The receipt is the release gate for dimensions/fps/duration/subtitle/safe-zone/
packshot/end-card/disclaimer evidence. Local ffmpeg frame extraction can produce
PPM samples from rendered video, and local PPM pixel analysis covers packshot
color coverage, end-card sample readability, and final-frame hold checks.
Automatic OCR/logo/loudness and direct PNG/JPEG image decoding still need
separate local tools or review.

After the receipt passes, register local provenance/content-credentials
metadata. This creates an unsigned local manifest unless an external signed
C2PA manifest is supplied:

```bash
clash production plan-content-credentials \
  --target-asset asset-tvc \
  --request plans/content-credentials.json \
  --out actions/content-credentials.json \
  --report qa/provenance/tiktok-15s.content-credentials.json \
  --json

clash production apply-metadata \
  --action actions/content-credentials.json \
  --assets assets/manifest.json \
  --json
```

This records target/ingredient hashes, actions, assertions, and optional
external C2PA manifest hashes. It does not sign or embed credentials.

- Use public reference video only when the user has rights or the use is analysis
  only.
- Record URL, title, channel/source, retrieved time, license/unknown, and
  derivative-use decision.
- Do not redistribute downloaded media by default.
- Treat reference analysis as inspiration and structure, not verbatim copying.

## TVC QA

Check:

- first-frame brand/product signal;
- claim/legal wording;
- logo and product visibility;
- safe area and platform dimensions;
- loudness/subtitle/disclaimer timing;
- final packshot and CTA;
- export package completeness.

## System Gaps

Needs browser capture/cookie-session handling beyond local yt-dlp-compatible
runner execution, automatic `video.shot-analysis` detection beyond local/agent
shot notes, video/audio fingerprinting
for non-copying QA, durable/legal-review rights workflow, image reference
sheets, timeline CAS, and rendered export validation against the delivery spec.
