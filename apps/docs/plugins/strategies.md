# Choosing a Strategy

> This is a current authoring guide. The normative Host/Provider state machine
> is the [Durable Run protocol](../guide/durable-run-protocol.md), and all media
> handles and publication follow the
> [Asset system](../guide/asset-system.md). Only the Local durable adapter is
> implemented; Cloud execution and Cloud Asset storage in those guides are
> future design.

A plugin makes a handful of choices, and each one is a closed set. Closed because the host
has to act on the answer — schedule work, reach an address, honour a guarantee — and it can
only do that for shapes it already understands. A free-form field would be a plugin
declaring behaviour the host cannot reason about.

This page collects those choices in one place. Each is documented in full elsewhere; here is
which one to pick and why.

## Waiting: synchronous, polled, or callback

| Provider behaviour                          | Return                   | Current Host does     |
| ------------------------------------------- | ------------------------ | --------------------- |
| Answers within the call                     | `completed`              | Nothing more          |
| Takes the work, exposes a status check      | `accepted` + `pollState` | Asks again on a timer |
| Takes the work, supports callbacks (future) | `accepted` + `pollState` | Keeps polling today   |

Pick synchronous only when the Provider returns the result from that one submit
call. Everything slower returns `accepted` with whatever the Provider needs to
be asked again — an id, a status URL, a job plus its region. The Host stores it
without reading it. The Plugin performs exactly one submit or poll operation
per invocation; the Host alone owns retries, pacing, deadlines, restart
recovery, and persistence.

Callback transport is reserved for a future Host adapter. The current Host
does not issue `callbackUrl` and does not receive Provider callbacks, so every
asynchronous executor must implement `poll` and return usable `pollState`.
Declaring callback support does not change that requirement today.

Never loop inside the plugin. A blocking wait keeps the upstream's identity in one call's
stack, so a crash strands work that has already been billed.

See [Waiting for a Provider](/plugins/waiting).

## Returning a result: ingest, upload, or handle

| You have                            | Return                               | Constraint                                    |
| ----------------------------------- | ------------------------------------ | --------------------------------------------- |
| The Provider published an HTTPS URL | `context.upload({ url, ... })`       | The Host ingests it before returning a handle |
| Small bytes in hand                 | `context.asset({ dataBase64, ... })` | Suitable only for a small broker frame        |
| Large bytes in hand                 | `context.upload({ bytes, ... })`     | The Host issues the upload target             |
| An Asset handle the Host issued     | typed `kind: "asset"` output         | Nothing to transfer                           |

A URL supplied as output is only an ingestion source. It never becomes Asset identity and is
never forwarded as an Asset projection. The Host copies the bytes into its staging store and
returns `{ assetId, uri, kind, mediaType? }`; durable publication consumes that receipt.

References travel in the other direction through the permanently named Asset
delivery `v0` API: `context.reference(reference)`. Compatible changes extend
`v0`; there is no `v1` Asset-delivery alias.
The Host returns decoded `bytes`, `text`, or a `provider-url` whose `providerUrl` and expiry
are already valid for the selected Provider binding. There is no generic URL reference form.

See [Manifest & Artifacts](/plugins/manifest).

## Runtime: local or hosted

This is not a capability list you compose. `runtime.kind` chooses the transport structure:
a local entrypoint uses stdio and a hosted entrypoint uses its declared remote transport.
The SDK business contract remains the same in both cases. The Host adapts reference delivery,
issues upload targets, ingests Provider result URLs, and returns canonical handles. A future
callback adapter may additionally issue a callback target; the current Host never does.

Nor should a plugin detect which host it is under. Everything it needs is already in what it
was handed: references arrive in a declared form and upload targets come from the Host. Plugins
must treat an absent `callbackUrl` as the current normal case and submit work for polling.

See [Overview](/plugins/overview).

## Credentials: how the plugin gets one

Routing selects an account before invocation. The Host binds `context.store`
to that plugin and account, and the plugin reads the actual values it needs.
Plugin code owns vendor-specific headers, JWT exchange, refresh, and regional
endpoint selection; the Host does not proxy the request or interpret the
credential.

Declare at least one source that works unattended. A plugin whose only credential path
requires a human at a browser cannot run on a schedule, cannot be resumed after a restart,
and cannot be tested without someone present.

A browser redirect capture is not an OAuth grant. If that is what your provider does, say
so — the host presents it differently, and mislabelling it produces a consent screen that
never appears.

See [Host-scoped SDK Context](/plugins/sdk-context).

## Language and build: declared, not scripted

State `runtime.language` and let the host compile. A plugin that ships its own build script
is a plugin whose output the host cannot reproduce, and reproducibility is what makes an
activation receipt meaningful.

See [Authoring Workflow](/plugins/authoring).

## Why these are closed sets

Each of these fields tells the host how to coordinate product-owned state: when to ask again,
whether an address can be handed to a third party, which account-scoped store to bind, and how
to build. The plugin still owns its ordinary process I/O and vendor protocol.

The alternative has been tried in this codebase. A command surface that let each concept
name its own verbs reached forty-four subcommands, every one a slightly different spelling
of the same few operations, and all of them were eventually deleted. Closed sets are what
keep the second plugin from inventing a fifth way to say "wait".
