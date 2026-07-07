---
name: product-logo-lock
description: Use when creating product/logo reference locks, packshot constraints, exact claim text, brand colors, OCR baselines, forbidden alterations, and product-image QA.
---

# Product Logo Lock

Use this skill before generating product or TVC images.

Record:

- packshot asset id;
- logo asset id;
- exact claim text;
- brand colors/materials;
- forbidden alterations;
- OCR baseline.

Generated panels must preserve approved product/logo constraints or be marked
blocked for review.

For Clash-managed local projects, make logo and packshot roles explicit before
generation:

```bash
clash production plan-reference-roles \
  --target-asset asset-reference-pack \
  --roles references/product-reference-roles.json \
  --out actions/product-reference-roles.json \
  --json
```

Use `logo-lock` for brand assets and `product-packshot` for packshots. These
roles should be locked and copy-on-write so downstream panels cannot mutate the
approved source asset.

After a generated frame, storyboard panel, or TVC end card exists, provide
agent/local analyzer evidence instead of silently trusting the render:

```bash
clash production plan-product-logo-qa \
  --target-asset asset-tvc-frame \
  --reference-roles projections/references/asset-reference-pack.semantic-reference-roles.json \
  --evidence qa/visual/product-logo-evidence.json \
  --out actions/product-logo-qa.json \
  --report qa/image/asset-tvc-frame.product-logo-qa.json \
  --json

clash production apply-metadata \
  --action actions/product-logo-qa.json \
  --assets assets/manifest.json \
  --json
```

The evidence file may come from OCR, visual inspection, or a local image QA
tool, but it must name the semantic role being checked. Failed or missing
locked-role evidence should block release instead of mutating the reference
asset.
