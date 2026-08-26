# Asset + Generator Model

> Status: this document is the authority for the native Generator v2 domain
> model. It distinguishes delivered contracts and Local Host infrastructure
> from product migrations that have not happened yet. Timeline and Director
> Stage are delivered as specialized projections over native Generator facts.
> Canvas generation, inline-edit paths, and legacy ASR consumers remain on their
> current models until each is explicitly migrated.

Clash has two first-class semantic concepts:

- an **Asset** is a durable product fact that another object can reference;
- a **Generator** is versioned state plus one or more named **Actions** that
  can materialize new Assets from exact inputs.

Asset is an umbrella term. Immutable media is represented by Project Assets
and content-addressed Resources. Structured, revisioned content is represented
by [Document Assets](/guide/document-assets). A Generator Action may currently
materialize either one Media Asset or one Document Asset.

## Vocabulary

| Concept              | Identity and mutability                                                                 | Delivered meaning                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Generator Definition | Immutable plugin artifact, pinned by plugin id, definition id, version, and schema hash | Declares state, edit policy, persistent input ports, and one or more Actions                                                    |
| Project Generator    | Stable mutable Project identity                                                         | Points at one immutable head revision                                                                                           |
| Generator Revision   | Immutable                                                                               | Pins the Definition, state, persistent input references, parent lineage, and optional COW fork source                           |
| Action               | Named method inside a Definition                                                        | Declares invocation-only inputs, parameters, one executor export, and an output contract; it is not a standalone mutable entity |
| Action Run           | Immutable request plus coarse public state                                              | Pins one Generator Revision, Action, executor, parameters, invocation references, fingerprint, and output contract              |
| Output Commit        | Immutable insert-or-compare fact                                                        | Pins one declared output slot to the winning Project Media Asset or exact Document revision                                     |
| Durable Task         | Owner-private execution record                                                          | Carries attempts, deadlines, Provider tokens, staging receipts, failures, and restart state                                     |

A Definition may register multiple Actions. The same Generator Revision can run
different Actions and produce different downstream Assets without rewriting
its state. The native `clash.codex-imagegen` definition delivered today has one
`generate` Action; multiple Actions are supported by the contract and authority,
not demonstrated by that particular artifact.

Director Stage now demonstrates the single-Action subset of that shape: its
native `clash.director` Definition exposes `capture-frame`, with each frame
materialized by a separate Action Run and output. A future Definition may expose
several Actions from the same frozen revision, but Director Stage does not yet
demonstrate that broader supported-model capability.

## Action means materialization

An Action is pure at the **domain boundary**: its observable semantic result is
the Asset committed to its declared output slot. It does not mutate the source
Generator Revision, rewrite an input Asset, advance a downstream head, or make
execution placement part of Project identity.

That does not mean executor code is side-effect-free or deterministic. An
executor may use Host-scoped capabilities, call a Provider, launch a renderer,
read account state, and upload bytes. Those controlled side effects belong to
the Host-owned Durable Task. At-least-once execution may produce different
candidate bytes; insert-or-compare publication chooses one output winner for
`(actionRunId, outputSlot)`.

An apparently in-place product operation, such as crop settings or frame
sampling controls rendered beside an output, should therefore be modeled as
editing Generator state and materializing a new Asset. Whether the product
advances the same Generator head or forks it is governed by the Definition's
edit policy. This model does not introduce a special mutating Action kind.

## State and inputs

A Generator Revision contains two kinds of semantic input:

- **persistent inputs** live with the revision and can be reused by every
  Action in the Definition;
- **invocation inputs** are selected for one Action Run only.

Both use named slots and declared cardinality. A reference pins one of:

- a Project Media Asset;
- an exact Document Asset revision;
- an exact Generator Revision from a declared Generator family.

The Run also freezes its Action parameters and semantic executor identity. The
executor reference contains the plugin id, version, export id, and schema hash.
Account selection, runtime process ids, retries, and execution realm are not
semantic inputs.

The delivered Local HTTP compiler resolves Media and exact Document references.
Although the domain contract can reference another Generator family, executable
Generator-family reference resolution is not supported by that Host surface
yet and fails closed.

The current Generator v2 profile requires exactly one output port with
`minItems: 1` and `maxItems: 1`. The types retain slot and item-key structure so
the contract can be extended deliberately later, but current code must not
claim multi-output execution.

## Versioning and copy-on-write

Every Generator Revision is immutable. Editing creates a new revision and then
performs an observed-head compare-and-set. The Definition chooses one of two
policies:

- `advance-head`: a successful edit advances the same Project Generator head;
- `fork-when-materialized`: once the observed revision is referenced by another
  Generator or by an Action Run, editing must create a new Project Generator
  with explicit `forkedFrom` lineage.

The policy belongs to the Definition, not to individual Actions. Existing
references remain pinned to their exact revision. Copy-on-write never silently
rewires downstream consumers.

The delivered Local HTTP surface advances an `advance-head` Generator with an
observed-head CAS. If a `fork-when-materialized` revision has already been
materialized, the same request fails with a copy-on-write hint; the caller uses
the existing create route with explicit `forkedFrom` lineage. There is no
separate fork endpoint.

Media outputs remain immutable facts. Document revisions are always immutable;
their Document head may either be `versioned` or `immutable` as described in
[Document Assets](/guide/document-assets).

## Public Run and private Task

Native Generator execution has two deliberately different state machines.

The Project-visible Action Run has exactly four states:

```text
pending -> running -> succeeded
   \          \----> failed
    \--------------> failed
```

`pending` exists after the immutable request is admitted. `running` is a
grow-only public fact written only after the owner-private Task exists.
Submission checkpoints those boundaries through the live Project room.
Replaying the **same stable submission command** can idempotently create a
missing private Task after a crash at that boundary; no automatic orphan scan
from arbitrary pending Project facts is claimed. Terminal success is valid only
after every required output commit exists.

The owner-private Durable Task has exactly six phases:

```text
queued -> submitting -> polling -> finalizing -> succeeded
                    \                 \-------> failed
                     \------------------------> failed
```

The private record owns the execution realm and owner, attempt counters,
deadlines, retry schedule, Provider poll state, staged output, and raw failure
details. None of those facts belong in Project Loro. The Local adapter is
delivered with SQLite, Local CAS, restart scheduling, and replay-safe Project
publication. A Cloud adapter is not delivered.

Legacy Canvas and provider flows still project status through their existing
nodes, bindings, or endpoint records. Timeline and Director Stage compatibility
surfaces instead project native Project Generator, Generator Revision, Action
Run, and Output Commit facts into their specialized CLI/MCP contracts; those
projections are not a second execution authority. Native outputs from these
migrated paths do not create legacy `ActionAssetBinding` records.

See [Durable Run Protocol](/guide/durable-run-protocol) for retry, deadline,
staging, and publication behavior.

## One ABI, two Local Host realms

Executable plugins expose one transport-neutral `PluginModule` invocation and
result ABI. The Local Host can place that same module in either of two realms:

| Host-selected realm | Current use                              | Boundary                                                         |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `bundled-module`    | Closed, trusted first-party registry     | Imported and invoked inside the Local Host process               |
| `process-stdio`     | Explicitly activated third-party package | Supervised child process using the same invocation/result schema |

Realm is deployment and diagnostics data, not Generator, Action, Run, or
executor identity. A first-party package may retain a local/stdio manifest
entrypoint as its distributable compatibility entrypoint while the closed Host
registry selects its bundled module at startup.

The process realm is fault isolation, not a security sandbox. Installing either
form installs trusted user code with ordinary runtime I/O. Host-scoped store,
reference, upload, Asset, and named tool capabilities still enforce the Clash
product boundary.

This lets built-in Generator families ship in the same first-party plugin shape
without a dedicated service process. Codex ImageGen, ASR, Timeline, and Director
Stage contribute native Definitions and Action executors from bundled
first-party modules. Timeline uses the Remotion executable plugin Definition
with the `clash.timeline` projection surface; Director Stage uses the
`clash.director` executable plugin with the `clash.director-stage` projection
surface. The specialized Timeline and Stage contracts remain compatibility
projections over those native facts.

## Delivery and migration status

| Area                                            | Status now                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generator v2 schemas and Project Loro authority | Delivered: heads, immutable revisions, COW rules, public Runs, output commits, peer-write guards                                                                                                                                                                                                                                                                                                                                                                           |
| Local Run bridge                                | Delivered for native Generator requests: public request before private Task, public running after Task creation, replay-safe Media and Document publication, and coherent batch admission/running checkpoint boundaries with replay repair of missing private tasks                                                                                                                                                                                                        |
| Plugin artifact and ABI                         | Delivered: Generator manifest contribution, Definition validation, semantic executor pinning, one module ABI across both Local realms                                                                                                                                                                                                                                                                                                                                      |
| Codex ImageGen                                  | A first-party plugin ships both its legacy Action Card and one native Generator Definition backed by the same `generate-image` executor; the generic Local HTTP surface can create and run it                                                                                                                                                                                                                                                                              |
| Local Host HTTP product surface                 | Delivered: list/read Definitions; create/read a Project Generator; observed-head revision advance; explicit create with optional fork lineage; submit/read a Run; and read an Output Commit. Host derives edit policy, provenance, executor, fingerprint, deadline, and realm-private Task facts. Project Generator collection listing, delete, and a standalone fork route are absent.                                                                                    |
| Generic Generator CLI and MCP                   | Delivered for the currently supported Local HTTP operations only: Definition list/read; Project Generator create/read/advance; Action Run submit/read; and Output Commit read. Project Generator collection list, delete, and standalone fork operations, plus GUI and a native working-tree projection, remain absent.                                                                                                                                                    |
| v1 compatibility adapters                       | Delivered as fail-closed conversion helpers and tests; they do not by themselves migrate live product data or routes                                                                                                                                                                                                                                                                                                                                                       |
| Canvas generation and custom Actions            | Not migrated; current runs use Canvas node and `ActionAssetBinding` projection, and custom plugins use the legacy `action` target                                                                                                                                                                                                                                                                                                                                          |
| Timeline                                        | Migrated as a specialized projection over native Project Generator and Generator Revision facts, using the Remotion executable plugin Definition with `clash.timeline`. Rendering uses native Action Runs and Output Commits. Specialized Timeline CLI/MCP remains a compatibility projection, and `timeline.validate` remains allowed. No generic Generator GUI or native working-tree projection is claimed.                                                             |
| Director Stage                                  | Migrated as a specialized projection using the `clash.director` executable plugin and `clash.director-stage` surface. Stage CRUD, owner semantics, and observed-head CAS are native. `capture-frame` creates one Action Run and output per frame; multi-frame public intent admission and running checkpoints are atomic, with replay repair. The renderer Host tool is reserved and bound to the frozen invocation. Native outputs create no legacy `ActionAssetBinding`. |
| Inline crop/frame/edit Actions                  | Not migrated; current paths retain their existing synchronous/CAS semantics                                                                                                                                                                                                                                                                                                                                                                                                |
| ASR native Generator path                       | Delivered: the strict `speech.transcribe` Broker/SDK ABI, reserved Local broker path, `clash.asr` bundled module and `speech-analysis` Definition, runtime model mapping, and an end-to-end native Run that publishes a timed `media.transcript@1` Document                                                                                                                                                                                                                |
| ASR legacy consumer migration                   | Not delivered: the legacy transcription route, Timeline transcript cache/editor, and other existing consumers have not been rewired to native Generator Runs and Document revisions                                                                                                                                                                                                                                                                                        |
| Human or agent Document authoring               | The Local HTTP API can create/read/list/version/attach typed Documents with Host-derived actor provenance; CLI/MCP/native file projection and consumer migration are not delivered                                                                                                                                                                                                                                                                                         |
| Cloud Generator execution                       | Not delivered; only the Local durable adapter exists                                                                                                                                                                                                                                                                                                                                                                                                                       |

“Supported by the model” and “available in the product” are intentionally
separate claims. A product surface is migrated only when it creates native
Generator revisions and Runs, uses their output commits, and preserves its
existing user behavior through that authority.

## Invariants

1. Actions are methods of a Generator Definition, never mutable first-class
   Project entities.
2. A Run pins one immutable Generator Revision and one exact semantic executor.
3. Runtime realm, account, process, attempts, and Provider tokens never affect
   semantic identity.
4. The current Action output contract is exactly one Asset.
5. Public Run state is four-state; private Task state is six-phase.
6. A successful Run has every required immutable Output Commit.
7. Copy-on-write preserves existing downstream references until an explicit
   rewire.
8. A plugin process is not a sandbox, and a bundled module is not a second ABI.
