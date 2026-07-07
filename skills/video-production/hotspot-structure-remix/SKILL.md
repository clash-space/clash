---
name: hotspot-structure-remix
description: Use when analyzing public hotspot videos for trend grammar, hook pacing, caption style, shot taxonomy, CTA structure, and creating original remix instructions without copying source media.
---

# Hotspot Structure Remix

Use this skill to transform a reference into new creative instructions.

Start by planning reference capture. The first plan is blocked by default:

```bash
clash production plan-reference-download \
  --source-url https://example.com/hotspot \
  --target-asset asset-reference \
  --out references/downloads/asset-reference.download-plan.json \
  --json
```

Only add `--allow-download` after the user and rights ledger permit local
analysis capture, then execute the reviewed plan explicitly:

```bash
clash production execute-reference-download \
  --plan references/downloads/asset-reference.download-plan.json \
  --assets assets/manifest.json \
  --out references/downloads/asset-reference.download-receipt.json \
  --json
```

Raw references stay under `references/raw/*` as quarantined analysis assets and
cannot enter final exports unless rights explicitly allow redistribution.

Extract:

- hook pattern;
- shot timing;
- caption rhythm;
- camera grammar;
- CTA/end-card pattern;
- platform conventions.

Output only a structure/remix plan. Raw frames, music, voice, creator likeness,
logos, or exact text cannot enter final output without rights.
