---
name: pipeline-manifest-architecture
description: Use when defining video pipeline manifests, stage graphs, dry runs, approval gates, artifacts, capability requirements, and machine-readable QA plans for Clash agent workflows.
---

# Pipeline Manifest Architecture

Model every production workflow as a stage graph with explicit artifacts.

Required manifest fields:

- `projectKind`
- `stages`
- `editableFiles`
- `protectedFiles`
- `requiredSystemCapabilities`
- `artifacts`: action, metadata, asset, projection, review-gate, export paths.
- `gates`, `dryRun`, and `qaChecks` when the workflow needs them.

Rules:

- Stages write files; they do not hide state in chat.
- Every managed pipeline should list concrete artifacts for action, metadata,
  asset, projection, review, and export coverage. Projection artifacts must
  declare `casRequired: true`.
- `requiredSystemCapabilities` means Clash-native automation bindings needed for
  managed execution. It is not a gate for producing portable draft artifacts.
- Expensive generation, public-reference ingest, and final export need gates.

## Clash Managed Pipeline Validation

Before a review/export gate, validate the manifest against actual local project
files:

```bash
clash production validate-pipeline-manifest \
  --pipeline pipeline.manifest.json \
  --out qa/pipeline/pipeline-validation.json \
  --json
```

This writes `kind: "clash.production.pipeline-validation"`. The report blocks
when action, metadata, asset, projection, review-gate, or export artifacts are
missing, or when projection artifacts do not declare `casRequired: true`.

## Clash Managed Review Gate

For local managed execution, keep the gate as a project-readable file and use
Clash only for review management:

```bash
clash production plan-review-gate \
  --pipeline pipeline.manifest.json \
  --stage export \
  --artifact projections/timelines/main.timeline.yaml \
  --artifact qa/delivery/tiktok-15s.validation.json \
  --out reviews/gates/export.review-gate.json \
  --json
```

This writes `kind: "clash.review.stage-gate"` plus a sibling lock file. Missing
artifacts keep the gate `blocked`; present artifacts move it to
`pending-review`. The lock is a read proof for this exact gate file: it binds
the gate path and the gate hash.

Approve or request changes explicitly:

```bash
clash production approve-review-gate \
  --gate reviews/gates/export.review-gate.json \
  --lock reviews/gates/export.review-gate.lock.json \
  --reviewer qa-agent \
  --decision approve \
  --note "artifact checks pass" \
  --json
```

Do not reuse a lock from a copied or different gate file. Re-plan or re-read
the gate when the path or contents change.

Approval is guarded by the gate lock hash. If the gate file changed after the
agent read it, re-plan or re-read before approving.
- Dry run must report missing providers, missing Clash-native bindings, and cost
  risks.
- Product state changes enter canvas/timeline through CLI/host APIs with CAS.
