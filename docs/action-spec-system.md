# Action Spec System

## Status

This document is the canonical contract for user-triggered actions that consume
workspace state and produce immutable results. It applies to Canvas, Asset
Preview, Timeline, agents, local execution, and cloud execution.

The first implemented action family is asset editing. Image and video editing
are not special UI-only pipelines: they are `family: "edit"` Action Specs.

## Domain model

The system has four separate concepts. They must not be collapsed into one
component or transport request.

1. **ActionSpec** declares a discoverable capability.
2. **ActionInvocation** records one validated user intent.
3. **ActionExecution** selects and runs an executor adapter.
4. **AssetResult** is a new immutable asset with provenance.

```text
ActionSpec
    |
    v
ActionInvocation (surface + explicit/implicit mode + typed params)
    |
    v
ActionExecution (model | client-render | server-transform | runtime)
    |
    v
Immutable AssetResult (actionInvocation metadata + edit-source lineage)
```

### ActionSpec

An Action Spec is serializable discovery data. It contains no React
components, callbacks, fetch clients, filesystem paths, or runtime functions.

Required fields:

- `id`: stable action identity, such as `image-editor`.
- `version`: version of the action contract.
- `name`: human-readable label.
- `family`: `generate`, `edit`, or `custom`.
- `inputKinds`: accepted asset kinds.
- `operations`: operation id, executor kind, and output asset kind.

The canonical schema is
`packages/shared-types/src/actions/spec.ts`. Built-in asset edit specs are in
`packages/shared-types/src/actions/asset-edit.ts`.

### ActionInvocation

An invocation is the durable, validated description of a single action:

- `actionId`
- `projectId`
- `source: { assetId, kind }`
- typed `params`
- `surface`: `canvas` or `asset-preview`
- `mode`: derived from the surface, never independently selected

Surface semantics are fixed:

| Surface | Mode | Visible graph representation |
| --- | --- | --- |
| Canvas | `explicit` | Create or use a visible action/edit node and connect the new result node. |
| Asset Preview | `implicit` | Run the same spec without adding a canvas node; switch Preview to the new result asset. |

`surface` describes where the intent originated. `mode` describes how that
intent is represented. They do not change the transformation semantics.

An API may temporarily accept legacy fields such as `editKind`, `editParams`,
and `origin`, but these are transport adapters. If both legacy fields and an
invocation are present, they must agree. New domain logic consumes the
validated invocation.

### ActionExecution

Execution code is selected by an operation's `executor`:

- `model`: a provider/model invocation.
- `client-render`: deterministic browser transformation, such as image crop,
  rotation, or extracting a video frame.
- `server-transform`: deterministic backend transformation, such as ffmpeg
  video trimming.
- `runtime`: another registered Clash runtime capability.

Executor adapters may differ between local and cloud deployments. The Action
Spec and ActionInvocation do not.

The UI owns intent collection and progress presentation. It must not redefine
action identity, output kind, lineage, or implicit/explicit semantics.

### AssetResult and lineage

Editing is copy-on-write. Apply never mutates the source asset or replaces its
blob. A successful execution creates a new asset with:

- `metadata.actionInvocation`: the validated invocation.
- `sources: [{ assetId: sourceId, role: "edit-source" }]`.
- `sourceModel`: the action id for explicit execution, or
  `implicit:<actionId>` for implicit execution.
- a new asset id and immutable storage key.

The result may become the current Preview asset or appear as a new Canvas node,
but it remains the same kind of durable asset in both cases.

Asset Preview may combine this immutable lineage with live project Canvas and
Timeline references to present navigable provenance. The UI projection is not
another ownership layer: `AssetResult` remains the durable generation/edit
record, while Loro remains the source of truth for where that asset is used.

## Built-in asset actions

| Action | Input | Operation | Executor | Output |
| --- | --- | --- | --- | --- |
| `image-editor` | image | `transform` | `client-render` | image |
| `video-clipper` | video | `screenshot` | `client-render` | image |
| `video-clipper` | video | `crop` | `server-transform` | video |

Adding a new editing tool means extending an Action Spec and typed invocation,
then registering an executor adapter. It does not mean adding another bespoke
Preview modal or Canvas-only pipeline.

## Ownership and module boundaries

- `packages/shared-types/src/actions/`: specs, invocation schemas, output-kind
  resolution, and representation rules.
- `packages/web-ui/src/features/assets/`: asset preview/editor composition,
  media URL resolution, thumbnails, and browser executor clients.
- `apps/local-api/src/`: local executor and immutable result persistence.
- `apps/api-cf/src/routes/v1/edits.ts`: cloud executor adapter and immutable
  result persistence.
- Canvas nodes: visible controls and graph projection for explicit invocation;
  they are not the source of the edit contract.

`ProjectEditor.tsx` may compose the asset feature into the workspace. It must
not own the asset action protocol or duplicate editor execution code.

## Required invariants

1. A spec is JSON-serializable and contains no runtime code.
2. Invocation mode is derived from surface.
3. Source kind and operation output kind are validated against the spec.
4. Local and cloud adapters accept the same invocation.
5. Apply creates a new asset and preserves `edit-source` lineage.
6. Preview and Canvas use the same editor/workspace implementation.
7. Preview execution does not silently create a visible Canvas node.
8. Canvas execution does not hide the action that produced its result.
9. Errors are rendered inside the action workspace; native blocking alerts are
   not part of the action contract.

## Agent workflow

When implementing or invoking an action:

1. Find the Action Spec by stable id.
2. Validate source kind and typed params.
3. Create an invocation from the originating surface.
4. Resolve the operation and executor from the spec.
5. Execute through the environment adapter.
6. Persist an immutable result with the invocation and lineage.
7. Project the result back into Preview, Canvas, or Timeline according to the
   invocation mode.

Do not infer action semantics from button text, component names, endpoint
names, or canvas node types.

## Compatibility and migration

`EDIT_KIND`, `editParams`, `editOrigin`, and the `/api/v1/edits` route remain
compatibility surfaces while callers migrate. `EDIT_KIND` is an alias of the
asset Action ids. Persisted `metadata.actionInvocation` is the canonical proof
for new results.

Legacy records without an invocation remain readable. New writes must include
the invocation.
