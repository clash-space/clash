---
name: reference-noncopying-qa
description: Use when a video was inspired by a public reference and must be checked for frame/audio/text copying, rights violations, or use of raw reference assets in final exports.
---

# Reference Non-Copying QA

Use this skill before exporting a reference-inspired video.

For local Clash projects, run the executable placeholder QA before applying
reference metadata:

```bash
clash production plan-reference-noncopying-qa \
  --reference analysis/reference-001.json \
  --proposal plans/proposed-tvc.json \
  --target-asset asset-reference \
  --out actions/reference-noncopying-qa.json \
  --report projections/references/reference-001.noncopying-qa.json \
  --json
```

Then apply the generated metadata action with `clash production apply-metadata`.
The report is agent-readable and records raw-reference asset reuse, structural
similarity, matched shot pairs, and the resulting `passed`, `requires-review`,
or `failed` status.

Before final export, verify the actual timeline projection against the asset
manifest:

```bash
clash production verify-reference-isolation \
  --timeline projections/timelines/tvc-30s.timeline.yaml \
  --assets assets/manifest.json \
  --out qa/reference/tvc-30s.reference-isolation.json \
  --json
```

This is the release gate for raw reference reuse. It blocks direct use of
quarantined `reference.download` assets and `references/raw/*` paths unless the
rights ledger explicitly allows final export.

Check:

- final assets do not point at `references/raw/*`;
- no source-frame fingerprint match unless rights allow it;
- no source audio/voice reuse unless rights allow it;
- no copied captions/text/creator likeness;
- rights ledger allows every derivative use.

If rights are unknown, output can use structure analysis only.

Current system limit: the CLI check is deterministic text/tag-level QA plus raw
asset path detection. It is not video fingerprinting, audio fingerprinting, or
creator-likeness detection yet.
