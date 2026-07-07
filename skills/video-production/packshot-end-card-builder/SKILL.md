---
name: packshot-end-card-builder
description: Use when building product packshots, final end cards, CTA lockups, offer/disclaimer text, QR/app-store/social badges, and final-frame QA for ads.
---

# Packshot End Card Builder

Use this skill for ad endings and product lockups.

Use `clash production plan-ad-delivery-spec` to record the packshot and end-card
gate in asset metadata:

```bash
clash production plan-ad-delivery-spec \
  --target-asset asset-tvc \
  --brand "Clash Skin" \
  --platforms tiktok \
  --durations 15 \
  --aspect 9:16 \
  --resolution 1080x1920 \
  --safe-zones 120,48,220,48 \
  --packshot-asset asset-packshot \
  --packshot-start 360 \
  --packshot-end 420 \
  --end-card-duration 90 \
  --cta "Shop now" \
  --disclaimer "Results vary." \
  --out actions/ad-delivery-spec.json \
  --json
```

The current system records packshot/end-card requirements and checklist items.
After rendering, extract audited local PPM frame samples from the rendered
variant:

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

Then generate local PPM pixel evidence from those samples:

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

Then normalize the local visual evidence into a portable report:

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

Then require that report in the delivery validation receipt:

```bash
clash production validate-ad-delivery-export \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --rendered exports/tiktok-15s.mp4 \
  --visual-report qa/visual/tiktok-15s.visual-qa.json \
  --out qa/delivery/tiktok-15s.validation.json \
  --json
```

`extract-ad-visual-frames` covers rendered video frame extraction into local
PPM samples. `analyze-ad-visual-pixels` covers packshot color sampling,
end-card sample readability, and final-frame hold checks from local PPM frames.
OCR/logo/loudness checks and direct PNG/JPEG image decoding must still be
supplied as local evidence or remain review gates before final export.

Required elements:

- product image/packshot;
- logo;
- CTA;
- offer or claim text;
- disclaimer if needed;
- platform-safe layout.

Rules:

- Product/logo/text comes from approved assets or explicit user claims.
- Final frame must be visible long enough for the platform and format.
- OCR/logo checks block export on drift.
