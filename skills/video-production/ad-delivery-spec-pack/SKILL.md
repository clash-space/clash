---
name: ad-delivery-spec-pack
description: Use when preparing TVC/ad delivery specs: 6s/15s/30s variants, platform aspect ratios, safe zones, subtitles, disclaimers, loudness, thumbnails, and export packages.
---

# Ad Delivery Spec Pack

Use this skill before final TVC export.

Generate the metadata-fill action explicitly:

```bash
clash production plan-ad-delivery-spec \
  --target-asset asset-tvc \
  --brand "Clash Skin" \
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

Apply writes `projections/delivery/<asset>.delivery-spec.json` with platform
variants, safe zones, packshot/end-card gates, disclaimer, rights link, and a
checklist.

After rendering each declared variant, extract audited local PPM frame samples
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

Then generate local pixel evidence from those PPM samples:

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

Then normalize local visual evidence into a portable report. The evidence can
come from the local pixel analyzer, another tool, or human QA; this command
records and gates it:

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

Then write a release receipt:

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

If `--probe` is omitted, Clash runs ffprobe on `--rendered`. Visual QA remains
an evidence/report contract: local ffmpeg frame extraction can produce PPM
samples for rendered video, and local PPM pixel analysis covers packshot color,
end-card sample readability, and final-frame hold checks; automatic OCR/logo/
loudness and direct PNG/JPEG image decoding are still separate gaps.

Then register provenance for the export:

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

This produces local provenance metadata and projections. It does not sign C2PA
manifests by itself.

Define:

- target platforms and aspect ratios;
- variant durations;
- safe area overlays;
- subtitles/disclaimers;
- audio/loudness expectations;
- thumbnail and filename conventions;
- package manifest.

Export validation must produce one receipt for every declared variant.
