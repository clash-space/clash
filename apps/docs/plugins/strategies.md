# Choosing a Strategy

A plugin makes a handful of choices, and each one is a closed set. Closed because the host
has to act on the answer — schedule work, reach an address, honour a guarantee — and it can
only do that for shapes it already understands. A free-form field would be a plugin
declaring behaviour the host cannot reason about.

This page collects those choices in one place. Each is documented in full elsewhere; here is
which one to pick and why.

## Waiting: synchronous, polled, or callback

| Provider behaviour | Return | Host does |
|---|---|---|
| Answers within the call | `completed` | Nothing more |
| Takes the work, exposes a status check | `accepted` + `pollState` | Asks again on a timer |
| Takes the work, calls back | `accepted` + `pollState` | Waits, then hands you the message |

Pick synchronous only when losing the host mid-call would not lose the work. Everything
slower returns `accepted` with whatever the provider needs to be asked again — an id, a
status URL, a job plus its region. The host stores it without reading it.

Never loop inside the plugin. A blocking wait keeps the upstream's identity in one call's
stack, so a crash strands work that has already been billed.

See [Waiting for a Provider](/plugins/waiting).

## Returning a result: bytes, URL, or handle

| You have | Return | Constraint |
|---|---|---|
| The provider published a public URL | `url` + `reach: "public"` | Must be reachable from outside the host |
| Bytes in hand | `dataBase64` | No reach — bytes have no address |
| An asset the host already knows | `sourceHandle` | Nothing to transfer |

A URL and a reach travel together and cannot be separated. A host-private loopback address
and a published one are both `https://` strings, and forwarding the first to a provider
points it at whatever answers on its own network. Reach cannot be recovered by inspection,
so the protocol carries it.

For uploads the direction reverses: the host issues the target address. An address the host
issues is reachable by construction; an address a plugin claims is a claim.

See [Manifest & Artifacts](/plugins/manifest).

## Runtime: local or hosted

This is not a capability list you compose. `runtime.kind` fixes what the plugin can reach,
and three separate-looking decisions all fall out of it:

| | Governed by reach |
|---|---|
| **Material coming in** | A `local` plugin may be handed the host's own address; a `hosted` one gets a published URL or bytes |
| **Results going out** | A `url` must state its reach; bytes state none |
| **Callback address** | Issued only by a host a provider can actually reach |

They are one fact wearing three hats. A `local` plugin shares the host's network namespace,
so a loopback address means something to it; a `hosted` plugin is somewhere else, where that
same string points at whatever answers on its own network.

Do not declare reach separately. Two attempts to add a second declaration for it were built
and deleted, because run mode already answers the question and a second answer can disagree
with the first — and a disagreement here is not a type error, it is a private address handed
to a stranger.

Nor should a plugin detect which host it is under. Everything it needs is already in what it
was handed: material arrives in a form it can use, and a callback address is present exactly
when one would work.

See [Overview](/plugins/overview).

## Credentials: how the plugin gets one

The plugin never sees a token. It names what it needs; the broker injects.

Declare at least one source that works unattended. A plugin whose only credential path
requires a human at a browser cannot run on a schedule, cannot be resumed after a restart,
and cannot be tested without someone present.

A browser redirect capture is not an OAuth grant. If that is what your provider does, say
so — the host presents it differently, and mislabelling it produces a consent screen that
never appears.

See [Capability Broker & Security](/plugins/broker).

## Language and build: declared, not scripted

State `runtime.language` and let the host compile. A plugin that ships its own build script
is a plugin whose output the host cannot reproduce, and reproducibility is what makes an
activation receipt meaningful.

See [Authoring Workflow](/plugins/authoring).

## Why these are closed sets

Each of these fields tells the host how to do something on the plugin's behalf: when to ask
again, whether an address can be handed to a third party, which credential to inject, how to
build. The host owns those actions, so it owns the vocabulary.

The alternative has been tried in this codebase. A command surface that let each concept
name its own verbs reached forty-four subcommands, every one a slightly different spelling
of the same few operations, and all of them were eventually deleted. Closed sets are what
keep the second plugin from inventing a fifth way to say "wait".
