---
name: agentic-video-architecture
description: Use when designing Clash video production workflows, skill packs, local/agent-first project structure, pipeline manifests, stage gates, file projections, CAS apply, or black-box QA for video/image generation workflows.
---

# Agentic Video Architecture

Use this skill before implementing or planning a new Clash production workflow.
It turns a video request into a staged pipeline that agents can operate through
files while product state remains protected by explicit apply commands.

## Core Pattern

Treat every workflow as a project-local pipeline:

```text
brief/                  human and agent editable
references/             source media and rights notes
assets/                 immutable generated/imported media
analysis/               machine-readable media intelligence
plans/                  agent-editable decisions
projections/            CAS-protected canvas/timeline files
exports/                rendered outputs and validation reports
pipeline.manifest.json  stage graph, gates, dependencies
```

The canvas is a view. `snapshot.bin` and DB files are not editing surfaces.
Agents can write drafts and plans, then apply product state through Clash CLI or
host APIs.

## Stage Model

Use these stages unless a workflow has a strong reason to differ:

1. `brief`: product goal, audience, format, duration, constraints.
2. `reference-ingest`: public references, brand media, raw footage, source URLs.
3. `analysis`: audio, transcript, shot, image, rights, or visual moment metadata.
4. `plan`: storyboard, cut plan, prompt pack, style plan, delivery specs.
5. `generate`: image/video/audio/MG assets, always versioned.
6. `assemble`: timeline projection, captions, overlays, asset references.
7. `review`: QA gates, legal/brand checks, stale-write checks.
8. `export`: rendered files plus validation report.

Each stage writes a clear artifact. Avoid invisible agent memory.

## Safety Rules

- Do not ask agents to edit `snapshot.bin`, SQLite, Loro files, credentials, or
  runtime directories.
- Any `pull -> edit -> apply` flow needs CAS.
- Referenced media is immutable; changing it creates a new asset or version.
- Public reference video ingestion needs a rights/source ledger.
- Expensive generation and final export should pass stage gates.
- In Clash-managed local runs, represent those gates with
  `clash production plan-review-gate` and explicit
  `clash production approve-review-gate`; the approval command must use the
  path-bound CAS lock generated for the same gate file. Agents should not
  silently treat missing QA artifacts as approved.
- Black-box E2E should verify artifacts from outside the implementation path.

## Output Contract

When using this skill, produce:

```json
{
  "pipeline": "short-drama | mv | talking-head | tvc | image-pack | custom",
  "stages": ["brief", "analysis", "plan", "generate", "assemble", "review", "export"],
  "editableFiles": [],
  "protectedFiles": [],
  "requiredSystemCapabilities": [],
  "missingSystemCapabilities": [],
  "qaChecks": []
}
```

## Migration Notes

- OpenMontage suggests pipeline manifests, stage directors, and broad tool maps.
- HyperFrames suggests an agent-friendly composition router plus domain skills.
- Montage-style systems suggest keeping deterministic analysis independent of
  optional LLM creative direction.
