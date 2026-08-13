# Architecture

## The pieces

```mermaid
flowchart LR
  cli["clash CLI\nshort-lived client"] -->|"HTTP / WebSocket"| host["local-api\nlocal daemon / host"]
  desktop["Desktop\nGUI + lifecycle client"] -->|"discovers or starts"| host
  mcp["clash mcp\npeer typed client"] -->|"HTTP / WebSocket"| host
  clients["SDK clients"] -->|"protocol calls"| host

  shared["Shared contracts and primitives\nshared-types + shared-runtime"]
  shared --> cli
  shared --> host
  shared --> desktop
  desktop --> desktopModules["Desktop modules\nElectron lifecycle + windowing + Remotion + OS integration"]

  host --> discovery["Host discovery\n~/.clash/run/host.json"]
  host --> state["Project state\nLoro + SQLite + assets"]
  host --> agents["ACP sessions"]
  host --> plugins["Plugin host + account-scoped SDK services"]
  host --> models["Built-in and local models"]
  host --> cloud["Optional cloud connector"]
```

`local-api` is the daemon in the architectural sense: it owns long-lived local
runtime state and processes. It runs as a standalone machine process. The
headless `clash` npm package, Desktop, and an optional daemon-only installer may
all carry the same reusable host artifact. Whichever is installed first, they
coordinate one compatible host per `CLASH_HOME` and profile rather than
embedding or starting a second host in Electron.

## Distribution boundary

The public headless Node distribution is one unscoped package, `clash`. Its
executable is a small dispatcher:

```text
clash <ordinary args> ──▶ bundled CLI client
clash mcp             ──▶ bundled stdio MCP client
both                  ──▶ discover/start bundled local-api host
```

`packages/cli`, `packages/mcp-server`, and `apps/local-api` remain separate
source modules so their responsibilities stay testable, but they are private
npm build inputs rather than separate user-installed Node products. The
local-api executable is an internal `clash` package asset, not a second npm CLI.
This does not prevent a daemon-only native/service release: that release must
reuse the exact same host artifact, discovery protocol, data directory, and
singleton lifecycle. The package manifest's `clashRuntime` map is the stable
artifact contract used by Desktop and daemon-only packaging; they copy that
host artifact rather than rebuilding a second host entry from source.

## Component installation and updates (target, not current)

The current implementation provides compatible-host discovery, a shared lock,
and detached launch from the `clash` package or Desktop. It does **not** yet
provide incompatible-version drain/takeover, a canonical versioned runtime
store, an active-version pointer, an owner/reference registry, or unreferenced
runtime garbage collection. Until those pieces exist, installers must not
delete or overwrite files owned by another package manager.

`clash` is also the canonical component manager for the headless runtime,
Desktop, and daemon-only installation. What is unified is not the download
channel. npm, DMG/installer, a daemon-only archive, and Homebrew may all acquire
the bootstrap. They own only their bootstrap or App files; the manager owns the
installed runtime and service lifecycle.

Every channel invokes the same installer core and protocol. That core verifies
a signed release manifest, installs immutable payloads into a content-addressed
runtime store, and records active component/version state in the canonical
`~/.clash/components` registry. Install, update, uninstall, status, atomic
activation, rollback, and daemon takeover resolve through that registry. They
must not create competing updater databases or overwrite an active runtime in
place. The singleton daemon still uses the shared discovery, lock, drain, and
same-data-directory rules described above.

Desktop's independent installer therefore invokes the same core and records
the same component state. The manager/bootstrap itself updates according to its
acquisition source (for example npm or Homebrew), while it continues to manage
runtime and service payloads through the signed manifest. A future surface such
as `clash install desktop` is valid only when a real downloadable Desktop
artifact, signing/feed contract, atomic activation, and rollback path exist.
Until then, the CLI must not expose placeholder install/update commands.

## Process ownership and dependency direction

The runtime dependency direction is:

```text
clash CLI ──HTTP/WebSocket──▶ local-api
clash mcp ──HTTP/WebSocket──▶ local-api
Desktop   ──discover/start──▶ local-api
Desktop   ──imports─────────▶ shared contracts/runtime + Desktop modules
```

- **CLI is a client.** It discovers the active host, calls its API, and manages explicit working-tree
  projections. It does not own ACP sessions, plugin subprocesses, local persistence, or cloud
  replication.
- **MCP is a peer client.** `clash mcp` calls the local host protocol directly. Its current Project
  catalog covers Assets, Canvas, Timeline, and Director with the same semantics as the matching CLI
  operations. Host/project/component lifecycle commands and working-tree projection conveniences
  remain CLI-only by design. Canvas collection management and Text Revision history/restore are the
  remaining MCP Project-semantic gaps. Neither client invokes the other or owns another daemon,
  Project replica, or independently implemented business layer.
- **Desktop is a shell and lifecycle client.** It discovers or starts the packaged `local-api` and renders the product
  UI against that host. It also directly consumes shared contracts and runtime primitives plus
  Desktop-specific modules such as Electron lifecycle, window management, OS integration, and
  Remotion packaging. `local-api` is its host dependency, not its only dependency.
- **`local-api` is the authority.** It owns host discovery, the canonical local replica, SQLite,
  assets, ACP/session lifecycle, plugin execution, account-scoped SDK services, and optional cloud
  connectivity.
- **Shared packages contain contracts and portable primitives only.** Code genuinely needed by more
  than one consumer belongs in `shared-types`, `shared-runtime`, or another purpose-specific shared
  package; host implementation stays in `local-api`.

Consequently, `local-api` must never import `@clash/cli` implementation modules. The CLI also
does not import `local-api` source code: its arrow to the daemon is a protocol dependency, not a
package dependency. Desktop's direct shared and platform dependencies remain separate from this
host relationship. Desktop may also package the CLI executable for child agents, but that is a
resource packaging edge, not permission for `local-api` to call into CLI internals. The host may
place that injected executable on an agent session's `PATH`; when the agent invokes it, the new CLI
process still calls back into the host over its protocol like any other client.

Host lifecycle is symmetric across installers. A compatible host already
published in discovery is reused whether it was started by `clash` or Desktop.
Closing Desktop or an MCP session must not stop the shared daemon. The
implemented path does not start a second per-Desktop daemon. A future
incompatible host replacement must go through the shared lock and a graceful
drain/shutdown before a new runtime takes over the same data directory; direct
takeover is intentionally not implemented yet.

## GUI and business-controller layers

The target presentation boundary is platform-neutral and does not own product
I/O. `@clash/gui` already owns the shared interaction primitives and a small
set of pure views, while most product views still live in `@clash/web-ui` and
are being separated from their Web/local controller glue. The completed shape
has Web and Desktop supply different controllers around the same `@clash/gui`
views:

```mermaid
flowchart LR
  gui["@clash/gui\npure React views + ports"]
  web["Web adapters\napps/web/app/adapters"] --> gui
  desktopController["Desktop controllers\napps/desktop/src/controller"] --> gui
  web --> hosted["Hosted HTTP / WebSocket APIs"]
  desktopController --> electron["Electron lifecycle + OS integration"]
  desktopController --> host["local-api daemon"]
```

The GUI package may depend on browser-safe contracts and visual primitives. It receives data and
actions through props or typed ports; it must not call `fetch`, open a `WebSocket`, access browser
storage, import Electron or `local-api`, or import `node:*`. Hosted authentication, projects, assets,
sessions, sync, and persistence adapters belong to the Web application. Host lifecycle, ACP,
windowing, and local runtime wiring belong to Desktop controllers. Until the extraction from
`@clash/web-ui` is complete, this diagram is a boundary rule and migration target rather than a
claim that every product view already lives in `@clash/gui`. Web must share Desktop's GUI, not
Desktop business logic.

## Asset system

The canonical Local Host authority, resolver, and consumer-CAS implementation
described in this section is current. Every post-cutover Local publication that
introduces new bytes is fail-closed at the implemented `asset-inspection/v4`
boundary: unsealed bytes are probed before canonical Resource sealing, and
incomplete or unavailable inspection publishes no Asset or binding.
Cross-scope publication over an existing sealed Resource reopens it and requires
its complete current v4 receipt without staging the bytes again. The one-way
legacy Project materializer is a documented compatibility exception, not a
current product write path. Team OSS, Resource Registry, multi-device transfer,
and unified Cloud/Web execution paragraphs describe the required future Cloud
adapter; existing hosted compatibility execution is not that adapter or Asset
authority.

Global and Project Asset libraries have independent product lifecycles while
sharing immutable, content-addressed Resources underneath. Project Assets are
owned entries or pinned links with Project-scoped access and retention claims.
Canvas, Timeline, Director, prompts, generation, editing, and rendering express
all strong media usage through Action input/output bindings. The current Host
resolves those stable identities to an entry-authorized `ResolvedAsset`.
Replaceable transport adapters may then mint a loopback URL, signed capability,
or read-only file projection. A missing/expired transport projection never
authorizes fallback to a raw storage key, local path, vendor URL, or an
unauthorized generic media route.

Every canonical Project or Global import preassigns its Asset id before byte
transfer and reuses that id for an ambiguous retry; both multipart routes reject
a missing id. The Host first stages exact bytes under digest and byte length,
without assigning Resource kind or media-type authority. It then requires the
v4 byte probe, validates frozen kind/media-type assertions, derives
display-normalized dimensions, `rotationDegrees`, and complete audio stream
facts, and seals the canonical Resource before consumer-CAS publication.
Caller dimensions, duration, codecs, stream flags, and audio-layout hints never
fill or override Host facts. Generated and transformed outputs use the frozen
`(actionRunId, outputSlot)` instead of an import id; at-least-once producer
duplicates may differ, but the consumer retains one verified winner.
Upload URLs, multipart sessions, local blob previews, and object keys are
transport state and cannot become import identity or publication evidence.

Project Loro currently synchronizes Project Asset entries and Action bindings,
never blob bytes, storage keys, local paths, signed URLs, or transfer progress.

```mermaid
flowchart TB
  subgraph core["Core Asset and execution model"]
    bytes["Imported or generated bytes"] --> staging["Unsealed local staging\ndigest + byte length"]
    staging --> probe["Required v4 byte probe"]
    probe --> cas["Canonical Resource seal\nversioned L1 facts"]
    cas --> publish["Consumer CAS publication"]
    publish --> project["ProjectAsset (+ declared ActionAssetBindings)\none Project mutation"]
    project --> resolver["Entry-authorized ResolvedAsset"]
  end
  subgraph experience["Non-authoritative adapters"]
    transport["Transport projection\nloopback URL or signed capability"]
    gui["GUI presentation adapters"]
    blob["Immediate blob preview"]
    deviceCache["Disposable poster / waveform / filmstrip cache"]
  end
  resolver -. "authorized replaceable projection" .-> transport
  transport --> gui
  gui --> blob
  gui --> deviceCache
```

The adapter layer is outside the authority loop: its object URLs, decoded
poster frames, peaks, filmstrip samples, progress UI, and retry state are
disposable. Current Local derives all three from the authorized original-media
projection in frontend code; it does not request a backend representation.
They cannot become Resource or Asset identity, synchronized metadata, an
Action binding, or a condition for declaring a Durable Run complete. Code for
those concerns therefore lives behind presentation/cache/transport adapters
rather than in the Asset SDK authority ports or Durable engine.

A loose import publishes only its Project Asset. A generated output always
publishes the Project Asset and its complete output binding set atomically;
imports that declare Action bindings use that same one-mutation boundary.

The byte producer and every retryable processor may run at least once. Stable
consumer keys make the published facts singular: the probe registry uses
Resource plus recipe version, while durable Action output uses `actionRunId +
outputSlot`. Poster, waveform, and filmstrip caches are not consumers in that
protocol. The Local publisher stages and probes before it atomically writes the
Project Asset and output binding; a crash never requires calling the Provider
again once its result is checkpointed.

The future Cloud adapter will record stable Resource-to-OSS bindings in the
cloud Resource Registry; it must not introduce a second Project sync envelope
or put OSS keys in Loro. Its target behavior allows local-origin structure to
synchronize before silent OSS upload finishes, while other Hosts reject
byte-dependent work until the Resource is ready. A cloud-origin ActionRun and
placeholder may likewise synchronize early, but its output ProjectAsset and
binding may appear only after verified OSS staging. Other devices will then
download and verify ready Resources asynchronously.

The target execution rule follows the initiating surface rather than a device
that later observes synchronized state: Web will use the cloud task runtime,
while Desktop, CLI, and MCP use the designated local-api Host. Only the Local
adapter of this unified protocol is implemented today. It persists the shared
Durable Run Engine and step graph through SQLite plus local CAS. The future Cloud adapter must reuse
that graph with Workflow state plus OSS staging. In both adapters, an ambiguous
interrupted submit may be attempted again as an explicit availability trade-off;
once a Provider task token is checkpointed, recovery only polls that task, and
publication remains idempotent. Attempt journals and Provider tokens stay
owner-private and Project Loro never holds a transaction open across an
external request. The current Local projection carries Canvas node outcome and
`ActionAssetBinding` lineage, not a standalone `ActionRun`. The future unified
Project entity may carry only the five coarse ActionRun states; it must never
carry private submit/poll phases or become the execution journal.

See [Durable Run Protocol](/guide/durable-run-protocol) for the shared step
graph, checkpoint and idempotency rules, collaboration projection, owner-only
recovery, and the future Cloud adapter ports.

Canonical Asset deletion is explicit and split into two lifecycles. The current
Local Host atomically checks Action bindings and changes the ProjectAsset to
`trashed` in Project Loro; that CRDT update is the complete user-visible delete
and remains undoable during the recovery window. Terminal Asset purge exists in
the shared authority/SDK but has no Local product command or scheduler yet. In
the future Cloud/physical-reclamation path, Registry reconciliation will release
a claim only after terminal purge, and a worker may remove OSS bytes only when
no claim remains. Cleanup failure may retain bytes but cannot change Project
state. Background orphan inference is never an Asset lifecycle mechanism.

See [Asset System: Product and Technical Design](/guide/asset-system) for the
complete product vocabulary, link rules, Action reference model, collaboration
protocol, deletion semantics, and migration plan.

## `clash-bridge` consolidation

`clash-bridge` was a historical standalone executable that combined a hosted reverse connection
with ACP sessions and plugin-host responsibilities. Those long-lived responsibilities overlap the
local daemon and therefore belong inside `local-api`; they are not a second local runtime.

The consolidated shape has no `clash-bridge` workspace package:

- ACP runtime, session management, plugin hosting, and the hosted connector live under `local-api`.
- Any `clash` command that configures or inspects this functionality remains a thin client of
  `local-api`.
- Local-only and cloud-connected operation use the same host, replica, and CLI protocol.

## Model catalog composition

The effective catalog a user sees is composed from three sources:

1. **Built-in model cards** — `MODEL_CARDS` in `@clash/shared-types`.
2. **Plugin cards** — cards exported by activated plugins.
3. **Plugin model bindings** — provider implementations exported by activated
   plugins and merged into existing cards.

Composition (`composeExecutablePluginModelCards`) merges plugin bindings into
each card's `providerImplementations`, so a third-party provider appears next
to first-party ones with the same mechanics (priority, overrides, credentials).

Provider selection per generation is routing over the composed card:
account-level model priorities, credential/OAuth availability, and
implementation `priority` decide the route. The catalog endpoint
(`GET /api/v1/models/catalog`) exposes the composed card, candidate providers,
and the selected route.

## Generation flow (plugin-backed provider)

```
UI/CLI submits task to local-api
  → host resolves route (card × provider implementation)
  → host binds the selected Provider account to the invocation
  → Durable Run Engine claims and checkpoints one submit or poll step
  → plugin host invokes the plugin's provider-executor once over stdio
  → plugin reads account-scoped state through context.store
  → plugin performs exactly one Provider operation with its own fetch/Axios/client
     (one submit, or one status poll plus completed-result conversion)
  → accepted state is checkpointed; the Host schedules the next poll step
  → completed outputs are staged unsealed, v4-probed, and sealed as canonical Resources
  → Project Asset + output binding are idempotently published by actionRunId + outputSlot
  → typed store/reference/upload operations are audited by the host
```

The manifest declares only what the plugin contributes. Network and filesystem
access are ordinary process capabilities; provider traffic recording and replay
are test-runner instrumentation, not branches in plugin business code. Provider
plugins never own retry loops, total task lifetime, restart recovery, or Project
publication; those belong to the Host's durable step graph.

## Kinds

`ModelKind = 'image' | 'video' | 'audio' | 'text' | 'asr'`. ASR is a
first-class kind: the five local ASR cards sit in the same registry and route
through the same composition as image/video/audio cards, with `providerId:
"local"` implementations that run on-device (see
[Local ASR](/guide/local-asr)).
