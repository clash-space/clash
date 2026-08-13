# Official and Custom Views with a Shared Action Runtime

Status: Superseded proposal; do not implement as the current runtime contract

Last updated: 2026-08-13

This proposal predates the current Asset and Durable Run contracts. Its
`AssetRevision`, synchronized standalone `ActionRun`, and execution-host
language below is historical. Use
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md) for
media identity/bindings and
[`apps/docs/guide/durable-run-protocol.md`](../apps/docs/guide/durable-run-protocol.md)
for the current Local journal plus design-only Cloud adapter. Any future Views
work must adapt to those contracts rather than reviving this proposal's data
model.

## Goal

Make Clash Projects support first-party Official Views and user- or
agent-authored Custom Views without creating a second Action system.

Every surface must reuse the same Action definitions, graph planning,
execution state machine, ActionRun provenance, immutable AssetRevision
outputs, permissions, and output routing. Whether a Custom View happens to use
an implicit Canvas is an implementation detail and must not be part of the
public product contract.

## Product Decisions

1. The asset catalog is the data plane. A Media Pool, Canvas, Timeline, table,
   storyboard, or HTML page is a presentation and interaction plane over that
   data.
2. Clash ships Official Views. Examples include Canvas, Timeline, Media Pool,
   metadata table, and future production-specific views.
3. Users and agents may create Custom Views from HTML, CSS, JavaScript, saved
   queries, entity references, and Action bindings.
4. `View` is a navigation/runtime concept, not a generic persistence container.
   Canvas and Timeline retain concrete IDs, ownership, and state models.
5. Action Definitions and the Action executor are surface-independent.
6. ActionNodes remain Canvas-native instances and checkpoints. A Custom View
   does not need to invent an ActionNode merely to invoke an Action Definition.
7. Existing Canvas graph composition is the composite execution model. A
   target plus its upstream closure produces a BuildPlan. Do not add a
   `CompositeAction`, `ActionPreset`, or parallel workflow abstraction.
8. An Action-capable Custom View may use a backing Canvas, but the View API and
   execution contract must not require one.
9. All Action execution produces an immutable ActionRun and immutable output
   AssetRevisions. Surface-specific output routing happens after execution.
10. Custom HTML is untrusted. It cannot directly access Loro, SQLite, product
    credentials, the host DOM, the filesystem, or arbitrary network resources.

## Current System Truth

The implementation already contains important pieces:

- Built-in image, video, audio, and text generation and `custom:<id>` actions
  converge through shared generation payload construction in
  `packages/shared-types/src/canvas.ts` and
  `packages/shared-types/src/canvas-ops.ts`.
- `packages/web-ui/src/components/nodes/buildPlan.ts` computes the minimum
  reverse-DAG plan needed to realize a target draft.
- `packages/web-ui/src/hooks/useCascadeRunner.ts` executes a seeded cohort with
  dependency gates, failure short-circuiting, and cancellation.
- `packages/web-ui/src/components/nodes/trajectoryPlan.ts` finds and clones a
  target's producing subgraph.
- Canvas graph payloads are downstream-owned `upstream` references; a small
  CRDT identity register resolves concurrent edge retarget/delete operations.
- Agent writes use cwd observations plus host-side CAS without public token or
  force flags.

The primary gap is architectural: graph planning and cascade execution remain
coupled to ReactFlow and React hooks. A Custom View cannot invoke the complete
Action system without going through Canvas UI code.

## Target Architecture

```text
                    Project entities and Asset Catalog
                                  |
                    Headless query and mutation host
                                  |
              +-------------------+-------------------+
              |                                       |
       Shared Action Host                      View Host Bridge
              |                                       |
      +-------+--------+                  +-----------+-----------+
      |                |                  |                       |
 single invoke    graph build       Official Views          Custom Views
      |                |            Canvas/Timeline          sandboxed HTML
      +-------+--------+                  |                       |
              |                           +-----------+-----------+
          ActionRun                                  |
              |                                typed intents
      AssetRevision outputs
              |
   output router: Project Assets | Canvas placement | View binding | Timeline
```

## View Model

### Navigation references

Use a discriminated union at the product navigation boundary:

```ts
type ViewRef =
  | { kind: "canvas"; canvasId: string }
  | { kind: "timeline"; timelineId: string }
  | { kind: "official"; definitionId: string; target?: EntityRef }
  | { kind: "custom"; customViewId: string };
```

Do not persist `viewId` on Canvas, Timeline, Asset, or ActionNode merely to fit
this union.

### Official View

An Official View definition contains a stable definition ID, supported target
kinds, public capabilities, and a trusted renderer maintained by Clash.
Official Views should use the same public Action Host contract as Custom Views
where practical. Trusted UI code may use additional internal read APIs, but it
must not create different Action semantics.

### Custom View

A Project-scoped Custom View has:

```ts
interface CustomView {
  id: string;
  name: string;
  currentRevisionId: string;
  capabilityManifest: ViewCapabilityManifest;
  pinnedEntityRefs: EntityRef[];
  savedQueries: SavedEntityQuery[];
}

interface CustomViewRevision {
  id: string;
  customViewId: string;
  sourceHash: string;
  bundleAssetRevisionId: string;
  createdAt: string;
  actor: ActorRef;
}
```

The source revision is immutable. Updating HTML creates a new revision and
moves the Custom View's current pointer. Loro retains collaborative pointer
history; SQLite/D1 indexes identities and revision metadata; immutable source
bundles live in the blob/AssetRevision store.

## Asset Catalog and Media Pool

Use the standard film-production separation:

```text
Global/tenant Asset Catalog
|- Asset
|  `- immutable AssetRevision
|- media locations, proxies, thumbnails
`- analysis metadata: ASR, beats, shots, people, rights, embeddings

Project
|- ProjectAssetRef
|- Bin / Collection
|- SmartBin saved query
`- Views over those references
```

Rules:

- Importing an existing catalog asset into another Project creates a reference,
  not another media blob.
- Bins contain references and may overlap.
- Smart Bins are saved queries and update as metadata changes.
- Canvas placements and Timeline items pin exact AssetRevision IDs.
- Removing from a Bin, unlinking from a Project, and permanently deleting an
  Asset are separate operations.
- The built-in Media Pool is the default Official View. It is not the only
  possible asset organization surface.

## Shared Action Contract

### Single Action invocation

```ts
interface ActionInvocation {
  projectId: string;
  actionRef: ActionDefinitionRef;
  inputs: ActionInputRef[];
  parameters: Record<string, unknown>;
  actor: ActorRef;
  outputRouting: ActionOutputRouting[];
}
```

The host resolves built-in model-backed and custom runtime-backed definitions
through the same capability and validation path.

### Existing graph composition

```ts
interface ActionGraphBuildRequest {
  projectId: string;
  graphRef: ActionGraphRef;
  targetNodeId: string;
  actor: ActorRef;
}
```

The planner computes the target's upstream closure and returns:

```ts
interface ActionBuildPlan {
  targetNodeId: string;
  entries: ActionBuildPlanEntry[];
  blockers: ActionBuildBlocker[];
  warnings: ActionBuildWarning[];
  estimatedInvocations: ActionInvocationEstimate[];
  cycle: boolean;
  planHash: string;
}
```

The caller confirms the plan hash. The host starts one ActionRun cohort and
executes it through the shared state machine. Canvas `Build +N` and Custom View
buttons call the same planner and executor.

No `CompositeAction` entity is introduced. Named or reusable compositions may
reference a graph target or clone an existing trajectory, but execution still
uses target plus upstream closure.

### Runtime operations

The surface-independent host exposes the semantic operations below. The exact
transport may be HTTP, local IPC, or an in-process adapter.

```ts
actions.describe(actionRef);
actions.invoke(invocation);
actions.planBuild({ graphRef, targetNodeId });
actions.startBuild({ planHash });
actions.cancel({ runId });
actions.observe({ runId });
```

CLI, first-party UI, local-api, cloud API, and the Custom View bridge must call
these operations rather than reimplementing execution.

## ActionRun and Output Routing

An ActionRun records:

- actor and runtime attribution;
- Action Definition and version;
- exact input AssetRevision IDs and text revisions;
- normalized parameters and model/provider route;
- parent cohort and graph target when applicable;
- status transitions, timing, cancellation, and failure reason;
- immutable output AssetRevision IDs;
- source Timeline/View revision when applicable.

Execution and placement are separate. Output routers may:

- add output to Project Media Pool only;
- create a Canvas AssetPlacement;
- bind output into a Custom View slot;
- insert an exact revision into a Timeline;
- perform more than one explicit route.

A View must not smuggle placement mutations into Action parameters. Routing is
visible, permission-checked host behavior.

## Custom View Host Bridge

Custom HTML runs in an opaque-origin sandboxed iframe with a restrictive CSP.
A bundled SDK communicates with the parent through validated `postMessage`
envelopes. Do not inject credentials or a direct JavaScript reference to host
services.

Initial SDK surface:

```ts
clash.project.getContext();
clash.assets.query(query);
clash.assets.get(assetRevisionId);
clash.selection.get();
clash.selection.set(entityRefs);
clash.actions.describe(actionRef);
clash.actions.invoke(invocation);
clash.actions.planBuild(graphTarget);
clash.actions.startBuild(planHash);
clash.actions.cancel(runId);
clash.actions.observe(runId);
clash.navigation.open(viewRef);
```

Capability manifests grant the minimum required operations and Action IDs.
Network access is denied by default. Destructive operations, new spending, and
high-cost build plans require host-owned confirmation UI that Custom HTML
cannot suppress or imitate.

## Agent Workflow

Custom View source is edited with native files in the agent's cwd:

```text
clash views list
clash views pull --view <custom-view-id>
# edit views/<name>/index.html, styles.css, view.js, manifest.json
clash views apply --view <custom-view-id>
```

Behavior:

- `list` and `pull` record the observed Custom View revision in
  `.clash/observed.json`.
- `apply` performs the implicit read check and host-side CAS.
- stale apply fails with `STALE_READ` and tells the agent to pull again.
- no public `readToken`, `--if-match`, or `--force` option exists.
- source files are projections. The canonical current revision is product
  state, not the cwd directory.

## Implementation Phases

### Phase 0: Stabilize the Project model

Deliverables:

- Finish one-Project/one-Loro multi-Canvas primitives.
- Finish standalone/Canvas-owned Timeline ownership and revision provenance.
- Remove asset-to-Canvas recovery seeding and embedded node `timelineDsl`.
- Keep concrete IDs and downstream-owned `upstream` references.

Tests:

- Shared Loro tests for multiple Canvases and Timelines in one document.
- CLI and UI parity tests for Canvas selection and Timeline ownership.
- Render provenance tests pinning exact Timeline revisions.

### Phase 1: Extract the headless Action graph planner

Deliverables:

- Move reverse-DAG planning from `packages/web-ui` into a framework-neutral
  shared package.
- Replace ReactFlow types with minimal graph reader interfaces.
- Use downstream `upstream` references as the canonical graph input.
- Preserve blockers, warnings, cycle detection, invocation estimates, and
  deterministic ordering.
- Make the existing Canvas dialog an adapter over the shared planner.

Tests:

- Port existing BuildPlan tests unchanged at the semantic level.
- Prove ReactFlow adapter and direct Loro adapter produce identical plans.
- Cover branching, completed checkpoints, custom actions, cycles, and stale
  graph changes.

### Phase 2: Extract the cascade execution state machine

Deliverables:

- Move gate, adoption, cohort, failure, cancellation, and resume semantics out
  of `useCascadeRunner` into shared runtime code.
- Persist ActionRun/cohort state through the Local Host and cloud host.
- Make the React hook observe and render host state instead of owning it.
- Add plan-hash CAS before starting a build.

Tests:

- Deterministic state-machine tests with fake clocks.
- Crash/resume and process-restart tests.
- Concurrent cancel/failure tests.
- Local and cloud adapter conformance tests.

### Phase 3: Normalize single Action execution

Deliverables:

- Extract invocation validation and runtime dispatch from Canvas mutation.
- Keep built-in and custom actions on one executor contract.
- Introduce durable ActionRun records and immutable output revision receipts.
- Implement explicit output routers.
- Change Canvas execution to call the shared host and then place outputs.

Tests:

- Canvas and headless invocation with identical inputs produce equivalent
  normalized invocation and provenance records.
- Offline local custom runtime behavior remains explicit and testable.
- Output routing never mutates an unrelated Canvas or Timeline.

### Phase 4: Implement Asset Catalog, Media Pool, and Bins

Deliverables:

- Global/local SQLite and cloud D1 schemas for Assets, AssetRevisions,
  locations, proxies, and analysis.
- ProjectAssetRef, Bin membership, and Smart Bin query contracts.
- Built-in Media Pool Official View with list/grid/table and metadata filters.
- Add-to-Project and Place-on-Canvas as separate operations.

Tests:

- One blob referenced by multiple Projects and Bins without duplication.
- Revision pinning in Canvas and Timeline.
- Bin removal versus Project unlink versus permanent delete.
- Offline query and cloud synchronization parity.

### Phase 5: Add the Official View registry

Deliverables:

- Typed Official View definitions and `ViewRef` navigation.
- Register Canvas, Timeline, and Media Pool without changing their domain
  storage models.
- Let official surfaces call the shared Action Host.
- Persist only intentional user layout/preferences, not transient UI presence.

Tests:

- Navigation resolves every ViewRef to the correct concrete target.
- No generic View record is required for Canvas or Timeline.
- Opening a View does not alter ownership.

### Phase 6: Add versioned Custom Views and CLI projection

Deliverables:

- CustomView and immutable CustomViewRevision schemas.
- Source bundle storage and content hashing.
- `clash views list/create/pull/apply/delete` with implicit cwd observations.
- Project navigation for Custom Views.

Tests:

- Native file round-trip with stable source hashes.
- missing-read, stale-read, and successful apply cases.
- concurrent user/agent edits through Loro and CAS.
- no force or client-supplied token escape hatch.

### Phase 7: Implement the sandbox and typed bridge

Deliverables:

- Opaque-origin iframe renderer and restrictive CSP.
- Versioned request/response/event protocol.
- Capability manifest validation.
- Asset query, selection, navigation, and Action Host SDK methods.
- Host-owned progress, cost confirmation, cancellation, and error UI.

Tests:

- CSP and sandbox escape attempts.
- forged message origin/session/request IDs.
- unauthorized Action and asset access.
- host restart and view reload with in-flight ActionRuns.
- accessibility and keyboard navigation for host-owned controls.

### Phase 8: Reuse Action graphs from Custom Views

Deliverables:

- Bind a View control to a single Action Definition or an existing graph
  target.
- Use the shared planner for graph previews and cost/blocker confirmation.
- Use the shared executor for start, progress, cancel, failure, and resume.
- Route results into Media Pool, View slots, Canvas placements, or Timeline
  items through explicit host configuration.

Tests:

- The same graph target started from Canvas and Custom View produces the same
  BuildPlan hash and execution ordering.
- Built-in and local/worker custom actions work through both surfaces.
- Outputs and ActionRun provenance are identical apart from initiating View
  attribution.
- A Custom View cannot bypass confirmation or route to an undeclared target.

### Phase 9: Black-box product verification

Scenarios:

1. Create a Project, multiple Canvases, a standalone Timeline, and a Custom
   View; restart and recover every path and ID.
2. Import media once, organize it into overlapping Bins and Smart Bins, and
   place the same revision on multiple Canvases.
3. Build an image-to-video Action graph from Canvas and from Custom View; verify
   matching plans, runs, outputs, and provenance.
4. Use a local custom action while its runtime is online, then verify the clear
   offline state when the machine/runtime is unavailable.
5. Pull a Custom View into an agent cwd, edit with native tools, apply, then
   verify stale CAS rejection after a concurrent human edit.
6. Attempt unauthorized network, credential, filesystem, DOM, Loro, and Action
   access from Custom HTML.
7. Render a Timeline after View-originated asset generation and verify exact
   AssetRevision and Timeline revision provenance.

## V1 Scope

V1 includes:

- Canvas, Timeline, and Media Pool as Official Views.
- One Custom View bundle format using HTML/CSS/JavaScript.
- Project asset queries and explicit pinned references.
- Single Action invocation and existing graph-target build invocation.
- Host-owned run progress, cancellation, errors, and output routing.
- Agent pull/edit/apply with implicit observation CAS.

V1 excludes:

- arbitrary Custom View network access;
- direct host DOM or persistence access;
- an npm package installer inside a View;
- a new CompositeAction or workflow language;
- requiring or forbidding an implicit Canvas;
- silently moving output into a Canvas or Timeline;
- treating cwd files as canonical project state.

## Definition of Done

The work is complete when:

- Official and Custom Views invoke the same headless Action host.
- Canvas no longer owns the only implementation of graph planning or cascade
  execution.
- built-in and custom Action execution share validation, run, provenance, and
  output contracts;
- Custom HTML can organize Project assets and drive allowed Actions without
  direct product-state access;
- Media Pool, Bins, Smart Bins, placements, and immutable revisions follow the
  reference model;
- all agent read-modify-write operations use implicit cwd observation plus
  host-side CAS;
- local and cloud hosts pass the same conformance suite;
- black-box desktop tests prove creation, restart/recovery, collaboration,
  sandboxing, Action reuse, and output provenance end to end.
