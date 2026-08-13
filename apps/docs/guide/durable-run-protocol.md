# Durable Run Protocol

> Status: shared target protocol. The Local adapter is the only implementation
> delivered in the current work. The Cloud adapter described here is a future
> port; this document does not claim that Cloud execution or failover exists.

The Local implementation does **not** create a standalone `ActionRun` entity in
Project Loro today. Its owner-private SQLite journal is the durable run record;
the current public projection is the Canvas node's
`pending/generating/completed/failed` status where a node exists, plus stable
`ActionAssetBinding` input/output lineage. The five-state coarse `ActionRun`
model below is the unified public design contract for a future Project entity,
including the future Cloud adapter, not a claim that such an entity already
synchronizes.

The current Local implementation is not a second, local-only state machine.
`@clash/shared-runtime` owns the executable graph, phases, compare-and-set
transitions, retry decisions, and `(actionRunId, outputSlot)` publication key.
`local-api` supplies the SQLite journal, local Resource CAS, Project publisher,
owner guard, and restart scheduler. First-party Google, MiniMax, fal, and Pika
executors, plus the installed Hilo peer, implement the Provider step contract
below. Volcengine migration is tracked and verified separately and is not
claimed by this delivery. A future Cloud adapter must reuse this engine and
replace only those durability ports.

Pika's bundled Local executor is covered by contract tests derived from the
public catalog schemas and deterministic HTTP fixtures. There is currently no
credentialed Pika live cassette, so this delivery does not claim that a real
paid upstream Pika generation was recorded and replayed. The older hosted
`apps/api-cf/src/services/pika-media.ts` path still waits in-process through
`waitForPikaMediaJob`; it is migration debt outside the Cloud design below,
not an implementation of the shared Durable Run Engine. A future Cloud port
must split that call into the same journaled one-submit/one-poll steps instead
of preserving the wait loop.

The retired ClashAgent path is not a Cloud adapter. `/api/v1/actions` no
longer distributes Python handlers, `/api/custom-action/upload` returns `410`,
and Local/hosted ProjectRoom sideband rejects
`register_custom_actions`, `unregister_custom_actions`, and
`complete_custom_task`. Cloud executable-plugin execution remains unavailable
until it can provide the same journal, staging, ownership, and publisher ports
defined below. `api-cf` therefore has no `custom_action` generation adapter;
pending hosted Action nodes fail closed instead of calling or retrying a Worker.

This delivery covers durable **ActionRun generation**, not every request that
may call a Provider. The voice-input endpoint
`/api/v1/local/audio/transcriptions` is currently a non-Action synchronous
utility boundary: it performs one Provider executor invocation, accepts only a
completed text result, and has no internal retry or poll loop. It does not
create a Project output. If voice input later accepts asynchronous work, needs
restart recovery, or publishes a Project Asset, it must create an ActionRun and
use this protocol. Until then, the implementation must not be described as
making every Local Provider call durable.

Director Hunyuan3D generation is part of the durable path. The official
`clash.fal/fal-execute` contribution translates exactly one fal queue submit or
poll step and returns its GLB through the Host-injected Asset upload capability.
`POST /api/v1/director-model-generations` freezes the Host-selected account and
returns a durable `actionRunId` plus status URL with HTTP `202`; it does not read
the API key or wait on fal. The GUI polls
`GET /api/v1/director-model-generations/:actionRunId`, which reads the journal
and may wake the owner scheduler but never polls the Provider itself. Completion
publishes a node-less Project Asset output and Action Asset binding through the
same staging and publication steps used by Canvas generation.

The Durable Run Engine gives every frozen `ActionRevision` one step graph and
one single-owner `ActionRun`. Local and Cloud execution are adapters for that
same graph, not separate workflows with approximately equivalent behaviour.
The initiating surface selects the owner when it creates the run: Desktop, CLI,
and MCP select a Local Host; Web selects Cloud when that runtime is available.
Ownership does not move during the run.

```mermaid
flowchart LR
  localClients["Desktop / CLI / MCP"] --> localOwner["Local owner<br/>current"]
  web["Web"] --> cloudOwner["Cloud owner<br/>future"]
  localOwner --> graph["One shared step graph"]
  cloudOwner --> graph
  graph --> provider["Provider submit / poll"]
  graph --> localPort["Local adapter<br/>SQLite journal + local CAS"]
  graph -. future .-> cloudPort["Cloud adapter<br/>Workflow journal + OSS staging"]
  localPort --> localPublisher["Local ProjectPublisher"]
  localPublisher --> localLoro["Local Project Loro<br/>Canvas node status + ActionAssetBinding"]
  localLoro -. "optional CRDT replication" .-> room["ProjectRoom<br/>remote sequencer + fan-out"]
  cloudPort -. future .-> cloudPublisher["Hosted ProjectPublisher"]
  cloudPublisher -. future .-> room
```

The two owner arrows are exclusive for a particular `actionRunId`. The diagram
does not describe fallback from one owner to the other. Only the Local owner
and Local durability ports are implemented; every Cloud owner/Workflow/OSS
arrow is target design for a future adapter.

## One graph, realm-specific durability ports

Every owner advances the following logical steps:

1. Freeze the Action revision, inputs, output slots, selected Provider route,
   and owner realm into an `ActionRun`.
2. Resolve and stage immutable inputs.
3. Submit at most one Provider request for the current attempt.
4. Checkpoint the Provider task token, or checkpoint an immediate result.
5. Poll a checkpointed task with one Provider status request per poll step.
6. Checkpoint the Provider result, then verify and stage each output.
7. Publish Project Asset entries and output bindings through
   `ProjectPublisher`.
8. Publish the public outcome. A conforming future Project `ActionRun` entity
   uses the terminal coarse state; the current Local adapter updates the Canvas
   node when present and publishes stable `ActionAssetBinding` lineage.

The graph owns transition rules, checkpoint meaning, idempotency keys, and
recovery decisions. An adapter owns persistence and byte staging only:

| Realm | Journal                 | Byte staging                    | Project publication | Delivery status |
| ----- | ----------------------- | ------------------------------- | ------------------- | --------------- |
| Local | SQLite run/step journal | Local content-addressed storage | Canvas + bindings   | Current work    |
| Cloud | Workflow journal        | OSS staging                     | `ProjectPublisher`  | Future port     |

Cloud must implement these three ports together: **Workflow journal + OSS
staging + ProjectPublisher**. A Workflow that bypasses the shared graph, writes
Loro directly, or invents a second output lifecycle is not this protocol.

## Provider step contract

A Provider executor invocation performs exactly one logical Provider step. It
does not own a retry loop, task lifetime, persistence, account selection, or
Project publication.

| Host operation | Plugin work in one invocation                                           | Valid result                                       |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `submit`       | At most one upstream submission                                         | `completed`, `accepted`, or `failed`               |
| `poll`         | At most one upstream status request for the supplied opaque `pollState` | `completed`, `accepted`, or `failed`               |
| `stage`        | Host-only verification and immutable byte installation                  | a durable staged output or structured Host failure |
| `publish`      | Host-only idempotent Project Asset/binding publication                  | success or structured Host failure                 |

`accepted.pollState` is deliberately opaque. The Host persists and returns it
unchanged; it may be a task ID, status URL, cursor, region tuple, or any other
JSON value. `retryAfterMs` is Provider scheduling advice, not permission for
the plugin to wait or poll internally.

Account identity is also opaque to the plugin contribution. The Host selects
the account within the current Project/user scope, injects its SDK
implementation and credentials at invocation time, and freezes only
owner-private routing state in the journal. Contributions and Project Loro do
not declare or synchronize `accountId`.

Every failure has this mandatory contract:

```ts
type ProviderFailure = Readonly<{
  code:
    | "invalid_request"
    | "authentication_failed"
    | "permission_denied"
    | "content_rejected"
    | "rate_limited"
    | "quota_exhausted"
    | "provider_unavailable"
    | "provider_failed"
    | "task_not_found"
    | "task_expired"
    | "transport_timeout"
    | "transport_error"
    | "invalid_response"
    | "execution_failed"
    | "contract_violation"
    | "cancelled"
    | "plugin_unavailable"
    | "deadline_exceeded"
    | "output_persistence_failed"
    | "publication_failed";
  message: string;
  retryable: boolean;
  requestState: "rejected" | "unknown" | "accepted";
  providerCode?: string;
  details?: JsonValue;
}>;
```

`code` and `requestState` are Clash policy facts, not raw Provider spellings.
Provider adapters classify explicit upstream verdicts through the shared SDK;
the Host validates that result, classifies transport/process failures it owns,
and normalizes an invalid poll boundary to `accepted`. `providerCode` retains
the raw upstream spelling for diagnostics. A plugin must not call a terminal
Provider verdict retryable merely because another submission could be made.

The engine applies the following decision matrix. `retryable` is an input to
bounded Host policy, never a command to retry on its own:

| Failed boundary                       | `requestState` | Host consequence                                                                                             |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| Submit was definitely rejected        | `rejected`     | Host may retry the submit when policy allows                                                                 |
| Submit transport outcome is ambiguous | `unknown`      | Host may retry with the same idempotency key; duplicate upstream work is the explicit availability trade-off |
| Submit was accepted but later failed  | `accepted`     | Never turn it into another submit; fail unless a checkpointed poll path remains                              |
| Poll failed transiently               | `accepted`     | Retry only the poll for the same `pollState`                                                                 |
| Stage failed transiently              | `accepted`     | Retry staging from checkpointed outputs; never call the Provider again                                       |
| Publish failed transiently            | `accepted`     | Retry the idempotent publication; never regenerate or restage known output                                   |
| Any non-retryable failure             | as reported    | Persist failure, publish only sanitized coarse state, and stop advancing Provider work                       |

The Action SDK supplies the common HTTP/transport classifier so first-party
plugins do not each invent a different meaning for HTTP 408, 429, 5xx, socket
loss, or timeout. The full author-facing explanation is in
[Waiting and asynchronous Provider work](/plugins/waiting).

## Deadline and recovery semantics

The default normal lifetime of a generation run is 30 minutes. This is one
absolute deadline shared from durable run creation through ordinary Provider,
staging, and publication attempts; it is not a 30-minute sleep, a per-step
retry budget, or a promise that an individual HTTP stack receives a fresh 30
minutes. Every invocation receives only the remaining budget. A Host may
configure the lifetime, while the Provider remains responsible only for one
invocation. The Local adapter exposes `providerGenerationDeadlineMs`; the
live/replay suite uses the separate
`CLASH_PROVIDER_E2E_TIMEOUT_MS` environment or config-file value. Both default
to 30 minutes.

When a checkpointed asynchronous task reaches the deadline, the owner performs
one final reconciliation poll, including after process restart. That poll may
still recover a just-completed result. If the Provider still reports pending,
the run becomes `deadline_exceeded`. A terminal Provider verdict retains its
structured failure code; a thrown final-poll error retains the Host-classified
transport/plugin code. Neither case retries that final poll. A run that never
crossed the submit boundary fails at the deadline without inventing a Provider
call.

When a poll first reports `completed` at or after the normal deadline, the
journal writes `recoveryFinalizationDeadlineAt` exactly once. This is normally
the final reconciliation poll; the clock-race case is defined below. Stage,
publish, and all of their retries share this persisted recovery deadline;
restart and changed Host defaults cannot extend it. The Host-configurable
`recoveryFinalizationTimeoutMs` defaults to 30 minutes. This is a bounded window
for idempotently installing and publishing bytes the Provider has already
finished, not a second Provider lifetime: only `stage` and `publish` may run.
Their attempt leases clamp to the same timestamp. If the window expires before
staging, the run fails with `output_persistence_failed`; if it expires while
publication remains, it fails with `publication_failed`. Provider submit or
poll can never resume from recovery finalization.

A poll claimed before the normal deadline can race the clock and return
`completed` just after it. That terminal response opens the same single
recovery-finalization window and consumes the need for a separate reconciliation
poll; discarding a known completed output only to issue another status request
would create a clock-scheduling-dependent result. This rule does not make the
poll lease longer: the invocation still receives only the budget remaining when
it was called.

Late finalizer results have an explicit asymmetric boundary because publication
is a product fact, while staging alone is not:

- if `stage` returns only after the normal or recovery deadline, that same
  `advance()` records `deadline_exceeded` or `output_persistence_failed`; bytes
  left in CAS remain unreferenced and may be reclaimed, and no publish attempt
  starts;
- if an already-claimed `publish` returns success after its lease, the Project
  mutation has happened and cannot honestly be relabelled failed. If its journal
  CAS still wins, the run checkpoints `succeeded` immediately. The deadline
  prevents another publication attempt from starting; it does not reverse an
  observed successful Project mutation.

Thus terminal outcome never depends on a later `advance()` noticing that the
clock moved between an external success and its checkpoint.

The public `ActionRun` design contract uses only these coarse product states:

```text
queued -> running -> finalizing -> succeeded
   \         \          \----------> failed
    \---------\--------------------> failed
```

The private durable phases are:

```text
queued -> submitting -> polling -> finalizing -> succeeded
                    \                 \-------> failed
                     \------------------------> failed
```

Each external side effect is bracketed by journal CAS checkpoints. One
`advance()` call performs at most one Provider, staging, or publication side
effect. Concurrent schedulers therefore either acquire the next attempt by CAS
or return `contended`; they do not both execute it. On restart the scheduler
scans recoverable journal rows, including overdue polling rows that still need
their final reconciliation poll.

## Provider and Loro boundary

Provider execution and Project Loro publication deliberately do not form a
distributed transaction. The bounded ambiguity lies between an external HTTP
request and the owner's durable checkpoint:

- A Provider submit may succeed upstream while its response is lost. If no task
  token or result was checkpointed, the same owner may retry according to the
  shared policy and can create duplicate upstream work.
- Once a task token is checkpointed, recovery polls that exact task. It must not
  submit replacement work.
- A synchronous result, or every completed asynchronous result envelope, is
  checkpointed before staging. Verified Resource identity and staging location
  are checkpointed separately before any Project binding is published.
- Project publication happens only through `ProjectPublisher`; no Provider
  request holds a Loro transaction open.

Loro is therefore the collaboration projection, not the attempt journal. A
future standalone Project `ActionRun` entity must use exactly `queued`,
`running`, `finalizing`, `succeeded`, or `failed` and may carry stable output
bindings. The current Local projection instead synchronizes Canvas node status
and `ActionAssetBinding` lineage; it does not materialize that five-state
entity. Neither form can authorize a Provider request or prove that one did or
did not happen. `submitting` and `polling` remain owner-private journal phases,
not additional Project states.

## Checkpoints and idempotent publication

The owner journals a token checkpoint immediately after a queued Provider
submit response, a Provider-result checkpoint before byte staging, and a
verified staged-output checkpoint before Project publication. Checkpoints are
monotonic: recovery may advance them but must not erase a known task token or
replace a verified result with a fresh attempt.

Every declared output has the idempotency key
`(actionRunId, outputSlot)`. `ProjectPublisher` treats publication as an upsert
of that one logical output:

- replaying publication cannot create a second Project Asset or binding;
- an existing binding to the same verified Resource is success;
- a conflicting Resource for the same key is a protocol conflict, not another
  valid output; and
- terminal-state replay cannot make a completed run execute again.

This key is shared across realms even though each run has only one owner. It
makes crash recovery safe; it is not permission for another realm to execute
the run.

## Collaboration and the remote sequencer

The current Local `ProjectPublisher` commits to the Host-owned local Project
Loro replica first. Optional collaboration then replicates that CRDT state to
the hosted `ProjectRoom`; a Local mutation does not synchronously call through
the room and the room is never a prerequisite for local work. `ProjectRoom` is
the remote sequencer and fan-out point for admitted synchronized state. A
future Cloud `ProjectPublisher` will publish through the room because the cloud
realm has no local Project authority. The room never runs Provider steps and
does not become the owner of Local runs.

Current Local multi-device and multi-user collaboration synchronizes only the
public Canvas node outcome, sanitized node failure information, and stable
`ActionAssetBinding` lineage containing `actionRunId`, Action revision identity,
and Project Asset/output bindings. It does not synchronize a standalone run
entity or owner realm. The future public `ActionRun` entity may additionally
carry the immutable owner realm and the five-state coarse status contract.

Provider account identity and credentials, API/session tokens, Provider task
tokens, attempt numbers, backoff state, raw responses, local paths, staging
keys, and execution logs remain private to the owner. They never enter Project
Loro. Another device can observe the current node/binding projection and consume
its published outputs, but cannot poll, retry, cancel, or resume it using
replicated state.

## Crash recovery

Recovery occurs only in the original owner realm and resumes from the latest
durable checkpoint:

| Last durable fact                             | Recovery action                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| Run exists, no submit token/result            | Resume the submit step under the shared ambiguous-submit policy           |
| Provider task token exists                    | Poll that token; never resubmit                                           |
| Result checkpoint exists                      | Resume verification/publication; never regenerate                         |
| Final poll completed after normal deadline    | Resume only stage/publish until the persisted recovery deadline           |
| Output binding exists, terminal state missing | Reconcile the same idempotency key, then publish terminal state           |
| Private journal is unavailable                | Report owner-side recovery failure; do not reconstruct attempts from Loro |

Workflow replay in the future Cloud adapter and process restart in the Local
adapter must produce these same decisions. Differences in storage technology
must not change the state machine.

Local recovery is daemon-driven: after binding its HTTP endpoint, local-api
enumerates every Project with non-terminal journal work, opens those Project
rooms, advances due checkpoints, and installs their next wake timers. No
Desktop reconnect, status request, CLI command, or Project mutation is required
to resume an accepted Provider task.

## Permission and ownership boundary

Run creation checks permission in the initiating realm and records the Project,
frozen Action revision, owner, Provider account scope, and allowed output slots.
The Local owner may use only locally available accounts authorized for that
Project operation. A future Cloud owner must use hosted membership and
account-grant checks. Credentials stay inside the selected realm.

`ProjectPublisher` rechecks that the caller owns the run, may publish to its
Project, and is writing a declared output slot. The Local publisher applies the
mutation to the canonical local replica; optional replication separately
enforces hosted admission at `ProjectRoom`. A future Cloud publisher must have
the room enforce hosted admission and sequencing before publication. Being able
to read synchronized run state or possessing a Resource identifier grants
neither execution ownership nor publish permission.

Cloud never automatically takes over a Local run when a device disconnects,
and a Local Host never takes over a Cloud run when Cloud is delayed. Reconnect
resumes the same owner; other clients remain observers. Moving work between
realms requires an explicit product operation that creates a new `ActionRun`
with a new identity and makes any reuse of prior immutable inputs visible. It
is not failover and must never result in two owners for one run.
