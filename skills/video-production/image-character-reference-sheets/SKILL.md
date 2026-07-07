---
name: image-character-reference-sheets
description: Use when creating character identity packs, 三视图, expression sheets, wardrobe variants, turnarounds, or locked visual references for short drama, TVC, storyboard, image generation, and video generation.
---

# Character Reference Sheets

Use this skill before generating storyboards or video shots that depend on a
stable character identity. The output is a locked reference pack, not a single
pretty portrait.

## Required Artifacts

```text
characters/protagonist.identity.json
assets/reference-sheets/characters/protagonist-front.png
assets/reference-sheets/characters/protagonist-side.png
assets/reference-sheets/characters/protagonist-back.png
assets/reference-sheets/characters/protagonist-expressions.png
analysis/image/protagonist-consistency.json
```

## Identity Contract

```json
{
  "characterId": "protagonist",
  "lockedTraits": ["face shape", "hair", "age", "body type"],
  "variableTraits": ["wardrobe", "emotion", "pose"],
  "views": [
    {
      "kind": "front",
      "assetId": "asset-protagonist-front",
      "assetPath": "assets/reference-sheets/characters/protagonist-front.png",
      "locked": true,
      "copyOnWriteRequired": true
    },
    {
      "kind": "side",
      "assetId": "asset-protagonist-side",
      "assetPath": "assets/reference-sheets/characters/protagonist-side.png",
      "locked": true,
      "copyOnWriteRequired": true
    },
    {
      "kind": "back",
      "assetId": "asset-protagonist-back",
      "assetPath": "assets/reference-sheets/characters/protagonist-back.png",
      "locked": true,
      "copyOnWriteRequired": true
    }
  ],
  "styleAnchors": [],
  "negativePrompts": [],
  "approvedAssetIds": ["asset-protagonist-front", "asset-protagonist-side", "asset-protagonist-back"]
}
```

## Rules

- Separate immutable identity from variable wardrobe/pose/emotion.
- Do not overwrite an approved reference sheet; create a new version.
- Use the same identity pack for storyboard panels and video prompts.
- Store consistency QA separately so agents can reason about drift.
- If a downstream storyboard uses a reference, edits must be copy-on-write.

## Clash Managed Storyboard Registration

Portable skill output is just local files plus readable JSON. When a Clash
project needs to collaborate on those references, convert approved views into
`storyboards/characters.json` entries with `referenceViews`, then explicitly
apply them:

```json
{
  "id": "protagonist",
  "name": "Protagonist",
  "referenceAssetIds": ["asset-protagonist-front", "asset-protagonist-side", "asset-protagonist-back"],
  "requiredViews": ["front", "side", "back"],
  "referenceViews": [
    {
      "view": "front",
      "assetId": "asset-protagonist-front",
      "path": "assets/reference-sheets/characters/protagonist-front.png",
      "locked": true,
      "copyOnWriteRequired": true
    }
  ]
}
```

```bash
clash production plan-storyboard-review \
  --target-asset asset-storyboard \
  --characters storyboards/characters.json \
  --scenes storyboards/scenes.json \
  --panels storyboards/panels.json \
  --out actions/storyboard-review.json \
  --json

clash production apply-metadata \
  --action actions/storyboard-review.json \
  --assets assets/manifest.json \
  --json
```

Managed apply writes the storyboard projection and registers each declared
reference view as a `character-reference-sheet` asset with
`image.character-reference-sheet` metadata. It does not generate images or
approve a mutable draft.

## Clash Managed Semantic Roles

For managed local projects, record the role of each reference asset explicitly:

```bash
clash production plan-reference-roles \
  --target-asset asset-reference-pack \
  --roles references/semantic-reference-roles.json \
  --out actions/reference-roles.json \
  --json

clash production apply-metadata \
  --action actions/reference-roles.json \
  --assets assets/manifest.json \
  --json
```

This writes `image.semantic-reference-roles` metadata to the reference pack,
projects `clash.image.semantic-reference-roles.projection`, and attaches
`image.semantic-reference-role` metadata to each individual reference asset.
Use roles such as `identity-front`, `identity-side`, `identity-back`,
`identity-expression`, `logo-lock`, and `product-packshot`; locked references
should require copy-on-write for downstream edits.

If local image embedding vectors are already generated, register them as
baseline metadata instead of embedding raw vectors into the canvas:

```bash
clash production plan-image-embedding-store \
  --target-asset asset-reference-pack \
  --embeddings embeddings/image-baselines.json \
  --out actions/image-embedding-store.json \
  --report qa/image/reference-baselines.embedding-store.json \
  --json

clash production apply-metadata \
  --action actions/image-embedding-store.json \
  --assets assets/manifest.json \
  --json
```

The embedding store records vector paths, hashes, model id, metric, and
copy-on-write baseline usage. It does not execute an embedding model.

If a local ComfyUI run produced reference sheets, register the pinned workflow
and generated outputs before using them downstream:

```bash
clash production plan-comfyui-workflow \
  --target-asset asset-image-job \
  --request plans/comfyui-reference-sheet.json \
  --out actions/comfyui-reference-sheet.json \
  --report qa/image/comfyui-reference-sheet.json \
  --json

clash production apply-metadata \
  --action actions/comfyui-reference-sheet.json \
  --assets assets/manifest.json \
  --json
```

This records workflow/output hashes, model/custom-node lineage, input slot
mapping, and per-output `image.comfyui-output` metadata. It does not execute
ComfyUI or install models.
