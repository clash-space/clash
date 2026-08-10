# Waiting for a Provider

A plugin at this level translates shapes. It turns Clash's request into the provider's
request and the provider's answer into Clash's answer. It does not wait, retry, or
remember anything between calls — those belong to the host, which is the only party that
survives its own restart.

## Three ways a provider answers

Providers answer in one of three ways. The protocol holds all three, and you implement
whichever ones your provider actually offers.

| | Provider behaviour | You return | Host does |
|---|---|---|---|
| **Synchronous** | Answers within the call | `completed` | Nothing more |
| **Polled** | Takes the work, exposes a status check | `accepted` + `pollState` | Asks you again on a timer |
| **Callback** | Takes the work, calls back when done | `accepted` + `pollState` | Waits to be called, then hands you the message |

### Synchronous

The call carries the result. Return `completed` and you are finished — no state to keep, no
second round trip.

Use this only when the provider genuinely answers within the call. The test is not a
duration you tune: it is whether losing the host mid-call would lose the work. A fast image
model qualifies. A video model that takes four minutes does not, even though waiting for it
would technically work.

### Polled

The provider takes the work and gives you something to ask about later. Return that
something as `pollState`; the host stores it and calls you back with it.

This is the default for anything slow, and the one to implement first. It needs nothing from
the host beyond a timer, works on a laptop with no public address, and authenticates in the
safe direction — the host opens the connection to the provider using a credential it holds,
so there is no inbound message to be fooled by.

### Callback

The provider calls a URL when it finishes. This is not polling with a different alarm clock;
it needs two things polling does not.

It needs an address, and you cannot supply one — a `local` plugin listens on nothing, and a
translator that exists for the length of one call has nowhere to keep a listener. The host
issues it, as `callbackUrl` on the submit invocation.

And it needs the arriving message to be translated and believed, because a POST from the
open internet is a stranger until proven otherwise. Both are covered under
[Callbacks](#callbacks) below.

Clash does not receive callbacks yet. A plugin that implements only polling keeps working
unchanged when it does, and a plugin that implements both should still implement polling —
it is the fallback when a callback never arrives, which happens.

## Accepting work

```ts
return {
  protocol: "clash.plugin.result/v1",
  invocationId,
  status: "accepted",
  pollState: { job: created.id, region: created.region },
  retryAfterMs: 5_000,
};
```

`pollState` is any JSON, stored verbatim and handed back untouched. The host reads none of
it.

It is deliberately not called `taskId`. Plenty of providers have no id: one returns a
status URL, another needs a region alongside a job name, a third hands back a cursor. A
field named for an id forces every provider without one to invent one, and inventing
identity to satisfy a schema is how a protocol stops describing the world.

`retryAfterMs` is the one field the host reads, because the host does the scheduling and
cannot act on advice it cannot see. Everything the plugin alone understands goes inside
`pollState`. That is the whole rule for where a fact belongs: outside if the host acts on
it, inside otherwise.

## Being asked again

The same export is called with `operation: "poll"` and the `pollState` you returned.

```ts
export default async function generate(invocation) {
  if (invocation.operation === "poll") {
    const status = await checkUpstream(invocation.pollState);
    if (status.pending) {
      return { ...ack, status: "accepted", pollState: invocation.pollState };
    }
    return { ...ack, status: "completed", outputs: [...] };
  }

  const created = await submitUpstream(invocation.input);
  return { ...ack, status: "accepted", pollState: { job: created.id } };
}
```

A poll returns `accepted` again while the work is unfinished, and may return different
`pollState` — a provider that hands out a fresh cursor each time is supported by saying so,
not by keeping a variable somewhere.

`operation` is an explicit field rather than something inferred from a missing one. A
plugin that mistakes a status query for a submission submits twice, and the user pays
twice. That failure is silent, arrives on a bill, and cannot be undone — worth a field.

## What not to write

Do not loop inside the plugin.

```ts
// Wrong: the upstream id lives only in this call's stack.
while (!done) {
  await sleep(5_000);
  done = await checkUpstream(id);
}
```

A blocking wait can last fifteen minutes for video. If the host stops during it — a crash,
an upgrade, a laptop lid — the work cannot be found again. The node stays pending forever
and the generation has already been billed. The loop also has to be written once per
plugin, and every copy gets the retry budget and the backoff slightly differently.

Hand the state back instead. The host stores it beside the node in the same document that
holds the canvas, so resuming after a restart is not a special path — it is the ordinary
one, reading the same record it would have read anyway.

## Callbacks

The host issues the address; the plugin never invents one. A `local` plugin listens on
nothing, and a translator that exists for the length of one call has nowhere to keep a
listener. This is the same rule as upload targets: an address the host issues is reachable
by construction, where an address a plugin claims is a claim.

At submit time the invocation may carry `callbackUrl`. Include it in the provider's request
if the provider supports one. If it is absent, submit for polling instead. Either way you
return `accepted`.

Its presence is the whole signal, and it is a fact about the host rather than a setting. A
local host on a laptop has no address a provider could reach, so it issues none and polls. A
cloud host does. The plugin needs no flag distinguishing the two and should not try to
detect which one it is running under: it reads whether an address was handed to it, and that
answer is already correct.

When the provider calls, the host hands the message back to you:

```ts
if (invocation.operation === "callback") {
  if (!verifySignature(invocation.callbackHeaders, invocation.callbackPayload)) {
    return { ...ack, status: "failed", error: { code: "bad_signature", message: "..." } };
  }
  return { ...ack, status: "completed", outputs: [...] };
}
```

The host does not read the body. It is in the provider's shape, which is the thing this
plugin exists to translate, so the host routes it rather than parsing it.

### Believing a callback

Anyone can send a POST. Two things stand between that and a forged completion, and the
plugin owns the important one.

The host makes the address unguessable, scoped to one task, expiring, and single-use, and
it will only settle the task the address was issued for. That last point matters more than
it looks: without it a valid callback for cheap work could complete expensive work.

But an address is a secret that travels. It goes through the provider's logs, every proxy
in between, and anything that forwards a referrer. So the address is not the defence — the
signature is. Providers sign callbacks in headers: an HMAC over the raw body, a timestamp,
a key id. Only you know which scheme this provider uses, so only you can check it, which is
why `callbackHeaders` is handed to you alongside the body.

Verify before you translate. Check the timestamp too, or a captured message can be replayed
later.

If you cannot verify, return `failed`. This does not strand the work: the poll path is
still there, and polling authenticates in the other direction — the host calls the provider
over a connection it opened and a credential it holds, which a forger cannot stand in the
middle of. Refusing an unverified message costs one round trip. Believing one costs whatever
the forger wanted.

## Sizing the choice

Return `completed` when the provider genuinely answers within the call. Return `accepted`
when it does not. The threshold is not a duration to tune: it is whether losing the host
mid-call would lose the work. If it would, the work needs a name the host can keep.


## Saying what the provider said

The three states are the host's: `running`, `completed`, `failed`. A provider's own words are its
own — `IN_QUEUE`, `PENDING`, `submitted`, `processing` and `RUNNING` all describe the first one, and
which of them you get depends on the model family.

So a pollable entry declares the translation in its manifest, and reports the provider's word
untranslated in its result:

```json
{
  "id": "hub-execute",
  "kind": "provider-executor",
  "handler": "execute",
  "operations": ["submit", "poll"],
  "statusMapping": {
    "running": ["processing", "queued", "in_progress"],
    "completed": ["success", "completed"],
    "failed": ["failed", "canceled", "insufficient_balance"]
  }
}
```

```ts
return { status: "accepted", pollState: { taskId }, providerStatus: raw.status };
```

The host reads one against the other. This is not ceremony: deciding whether a generation is alive
is not shape translation, and a plugin left to decide reaches for the same rule every time —
*anything I do not recognise is still running*. That rule is wrong in the one direction that costs
money. A status introduced upstream next month, a spelling that differs by a letter, a terminal
failure phrased in a way the list never learned: each becomes an unbounded wait for work that has
already died, and the only symptom is that nothing ever happens.

Inverting it costs a surfaced error naming the word you did not map, on a run you can fix. Those are
not comparable, so an unmapped status is `failed`.

Two rules follow, both enforced at activation rather than discovered in someone's paid generation:

- an entry that declares `poll` must declare `statusMapping` — polling reads the answer against
  something, or it reads it against nothing;
- an entry that does not poll must not declare one — a vocabulary nothing reads looks like the
  question was considered.

Every state needs at least one word. A mapping with no failure words cannot report a failure, and a
dead job would then sit until the host's own deadline expires. That deadline exists for silence, not
as a substitute for reading what the provider said.
