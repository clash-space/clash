---
name: video-release-checkpoint
description: Use before claiming a video export is done; validates rendered outputs, duration, fps, dimensions, audio, captions, safe areas, packshot/end card, rights, and source references.
---

# Video Release Checkpoint

Use this skill as the final QA gate.

Check:

- file exists and decodes;
- expected duration, fps, dimensions, codec;
- audio exists and loudness is acceptable;
- captions/disclaimers are timed and safe-area compliant;
- referenced assets exist and are not raw public references unless allowed;
- packshot/end card/CTA requirements pass;
- final report records renderer, input timeline hash, and validation results.

For TVC/ad delivery variants, extract audited PPM frame samples from the
rendered export, generate local pixel evidence, normalize visual evidence, then
use the managed receipt command:

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

```bash
clash production plan-ad-visual-qa \
  --target-asset asset-tvc \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --evidence analysis/visual/tiktok-15s.pixel-evidence.json \
  --out actions/ad-visual-qa.json \
  --report qa/visual/tiktok-15s.visual-qa.json \
  --json
```

```bash
clash production validate-ad-delivery-export \
  --delivery-spec projections/delivery/asset-tvc.delivery-spec.json \
  --variant tiktok-9x16-15s \
  --rendered exports/tiktok-15s.mp4 \
  --visual-report qa/visual/tiktok-15s.visual-qa.json \
  --out qa/delivery/tiktok-15s.validation.json \
  --json
```

If `--probe` is omitted, the command probes the rendered file with ffprobe.
Use `--probe analysis/probe/<variant>.probe.json` when another renderer has
already produced a trusted media probe. The receipt is a release gate; it does
not automatically perform OCR/logo/loudness analysis. Local ffmpeg frame
extraction can produce PPM samples from rendered video; local PPM pixel analysis
covers packshot color sampling, end-card sample readability, and final-frame
hold checks. OCR/logo/loudness or non-PPM image decoding must still be supplied
as visual QA evidence or kept blocked for review.

Do not call an export complete without a receipt.
