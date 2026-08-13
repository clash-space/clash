# Historical: Agent-First Local v1 CLI CAS Audit

> **Status:** Point-in-time audit, superseded as a command or coverage
> inventory. The generic implicit-observation and no-force findings remain
> architectural context, but Asset commands, metadata paths, and test coverage
> below reflect the date shown. Use live `clash --help`, the
> [Asset system](../apps/docs/guide/asset-system.md), and the
> [Durable Run protocol](../apps/docs/guide/durable-run-protocol.md) for current
> contracts. Cloud Asset storage and Cloud execution remain design-only.

Last updated: 2026-07-10

## Audit Rule

Any agent mutation whose correctness depends on existing product state must be
preceded by an explicit CLI read. The CLI records the observed entity version in
the agent cwd and supplies it to the host internally.

```text
read presence -> compare observed/current version -> semantic guardrails -> mutation
```

The public CLI has no manual compare token, lock-file argument, or overwrite
bypass. Pure creation of a new entity or immutable fact is exempt from the read
step but still needs validation and idempotency.

## State Contract

- Project pointer: `.clash/project.toml`
- Cwd observation state: `.clash/observed.json`
- Canonical collaborative state: Loro/host-owned project replica
- Relational metadata/config: host-owned SQLite
- Editable files: cwd projections and drafts
- Immutable facts: media blobs and applied text revisions; Timeline revision
  identity/history remains in Loro

The observation file stores only project identity and entity versions. It does
not cache entity bodies, permissions, commands, mutation reasons, or mutable
field lists.

## Command Matrix

| Read/materialize | Mutation | Observation key | Result |
| --- | --- | --- | --- |
| `clash canvas get --node <id>` | `canvas update`, `canvas delete`, `canvas copy`, `canvas replace-asset` | `canvas-node:<id>` | Missing read fails; stale read fails; downstream-referenced node is immutable; copy/replace are explicit COW |
| `clash canvas edges` | edge add/update/delete through host/ACP | graph or edge identity | Existing graph changes are compared by the host; same-event create-and-connect is exempt |
| `clash canvas delete-plan` | `canvas delete-batch --yes` | graph-aware delete-set identity | Closed-subgraph validation and CAS happen atomically |
| `clash timeline pull --timeline <id>` | `timeline apply --timeline <id>` | `timeline:<id>` | YAML is editable; apply advances the concrete Project Timeline under implicit CAS |
| `clash text pull --node <id>` | `text apply`, `text replace` | `text:<id>` | Markdown is editable; referenced text evolves through COW |
| `clash projects get --id <id>` | `projects delete --yes` | `project:<id>` | Recoverable soft-delete with implicit CAS |
| `projects get --include-deleted` | `projects restore`, `projects purge --yes` | `project:<id>` | Restore/purge consumes the deleted-project observation; purge policy remains host-enforced |
| `clash asset get --asset <id>` | cover/config metadata updates | `asset:<id>` | Asset blobs stay immutable; only metadata/reference state moves |
| `clash asset ref get` | `asset ref delete --yes` | asset/project relation | Membership deletion is explicit and stale-safe |
| `clash models providers` | provider account set/delete | provider account or collection | Agent mutation uses the observed public config version; secrets never enter cwd state |
| `production project-storyboard-prompt-pack` | prompt-pack apply/replace | path-bound prompt-pack identity | Apply updates managed projection; replace writes a versioned COW projection |
| `production plan-review-gate` | `approve-review-gate` | path-bound review-gate identity | Copied, unread, or stale gates fail |
| `production apply-metadata` | `apply-metadata-projection` | primary metadata projection path | Source action and current asset metadata are both covered by the composite version |

## Commands That Do Not Need Prior Reads

- `clash canvas add`
- `clash projects create`
- immutable asset import/upload with a new content identity
- local action package install when same-version idempotency is enforced
- read-only task status/wait and history/content retrieval
- production planners that only write new cwd artifacts

If a create command reuses an existing stable ID, it must reject a conflicting
payload rather than silently becoming an update.

## File Projection Findings

### Timeline

- Pull writes YAML and records the canonical timeline version.
- Apply has no sidecar or manual compare option.
- Host/daemon validates the same expected semantic version before Loro mutation.
- Apply atomically advances the concrete Project Timeline revision in Loro.
- Caption, handoff, and burn exports pin that revision when the Timeline ID and
  semantic hash match; otherwise they label the file as a draft.

### Text

- Pull writes body-only Markdown and records the text version.
- Apply/replace use implicit CAS and create applied text revision milestones.
- A referenced source is not rewritten in place; replace creates lineage and
  leaves old downstream references pinned.

### Production JSON

- Review gates and storyboard prompt packs record path-bound observations.
- Asset metadata uses a provenance manifest containing target, metadata kind,
  source action path/hash, and base metadata hash. The manifest is not mutation
  authority; the cwd observation is.
- Derived reports and projections are outputs unless a specific command declares
  an editable/apply contract.

## Direct Patch Findings

Direct canvas patch commands remain useful for narrow semantic changes, but are
not a substitute for structured file projection:

- timeline/provenance-owned fields are rejected,
- text/timeline apply uses their typed commands,
- fulfilled referenced media replacement uses explicit COW,
- any downstream edge makes a node immutable as a whole,
- graph-aware batch delete validates the complete delete set,
- there is no hidden admin/force path.

The Web UI, daemon, local API, and CLI must call the same shared guardrails so a
different transport cannot bypass the product rule.

## Public Versus Internal CAS

The local host may issue receipt-bearing internal versions. The CLI stores the
opaque observation in owner-only cwd state and keeps receipts out of command
syntax and public JSON.

This split lets cloud collaboration strengthen admission without changing the
local workflow. Both local and cloud paths still mutate the same local product
model and Loro semantics.

## Copy-On-Write Findings

- `canvas copy` is the uniform node-level COW action.
- `canvas replace-asset`, `text replace`, and storyboard prompt-pack replace
  provide typed convenience behavior. Timeline Action copy creates a new
  Timeline identity instead of replacing Timeline state.
- Existing downstream edges remain on the source.
- Source-to-copy lineage is explicit.
- A copied node is mutable until it acquires a downstream edge.
- Downstream exports preserve source asset/revision/timeline provenance.

## Recovery Exception

`doctor storage-recovery compare/restore` operates on quarantined canonical
bytes while normal product APIs may be unavailable. Its explicit compare value
and confirmation are support/recovery safeguards, not a precedent for normal
agent mutations.

## Verified Coverage

- cwd observation state atomic read/write tests,
- shared observation validation tests,
- daemon read-presence/stale/immutable/COW tests,
- canvas/text/timeline/project/asset/model command tests,
- review gate, storyboard prompt-pack, and asset metadata projection tests,
- skill registry/schema/artifact E2E,
- real CLI subprocess black-box coverage for missing read, stale read, re-read,
  immutable node, copy lineage, projection apply, revision provenance, and
  local operation without cloud credentials.

## Remaining Risks

1. Keep all new mutation commands on the shared observation adapter; a one-off
   command that reads then writes internally can accidentally bypass cwd read
   presence.
2. Keep public result sanitization recursive as response envelopes evolve.
3. Preserve cloud collaboration tests without adding a second local mutation
   model or cloud precondition to local commands.
4. Keep recovery commands visibly separate from normal project editing.
5. Add deterministic concurrent-write tests whenever a new SQLite or Loro
   mutation family is introduced.
