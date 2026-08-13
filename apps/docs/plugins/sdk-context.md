# Host-scoped SDK Context

Plugins are normal processes and own their external I/O. Clash injects only
the dependencies that belong to Clash itself: account state, project
references, asset persistence, and explicitly contributed Host tools.

`assemblePlugin` accepts the manifest location and `contributes` implementation
only. A plugin cannot provide a static `context` or replace Host capabilities;
tests inject fakes through the Host-side invocation/transport adapter instead.

## Account-scoped state

Routing selects the provider account before the plugin is invoked. The Host
then binds `context.store` to the tuple `(plugin, selected account)`:

```ts
const token = await context.store?.get("accessToken");
await context.store?.put("accessToken", refreshedToken, {
  secret: true,
  expiresAt,
});
```

The API accepts only a key. It deliberately has no `pluginId`, `providerId`, or
`accountId` parameter. An executor therefore cannot read another account by
putting an id in an invocation or store call.

State is opaque to the Host. The provider declaration names the fields shown
to the user, while plugin code decides how those values become vendor headers,
JWT exchanges, refresh requests, or regional endpoints.

## Direct vendor I/O

Use the runtime's ordinary HTTP client:

```ts
const response = await globalThis.fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});
```

Clash does not proxy the call, inject auth headers, or enforce a manifest
domain list. The plugin owns construction of the one vendor operation it was
asked to perform, vendor-specific redirects or file transfer needed to finish
that operation, and vendor error parsing. It does **not** own submit/poll retry
loops, polling cadence, total run lifetime, restart recovery, or Project
publication; the Host durable runner owns those concerns.

## Typed references: Asset delivery v0

This contract is permanently named `v0`; it is not a temporary version label.
Compatible changes extend `v0`; there is no parallel `reach` dialect or `v1`
Asset-delivery alias.

`context.reference(reference)` resolves a Clash reference without exposing a
storage path. It returns one of the forms the Host can supply:

- decoded bytes plus media type;
- `provider-url` with a Provider-fetchable URL and expiry;
- text.

Pass a frozen reference from `invocation.input.references`. The Host authorizes
its invocation-scoped identity (slot, Asset id, and kind) before reading
Project bytes. Knowing an Asset id from the same Project does not authorize a
plugin to resolve it under another slot or kind.

The plugin chooses the vendor-specific adaptation: inline the bytes, forward a
`providerUrl`, or upload bytes to the vendor first. The Host returns
`form: "provider-url"` only after it has produced an address the selected
Provider may fetch.

When a concrete Provider/model route can operate only on an
internet-reachable Asset, declare that delivery requirement on the model
binding:

```json
{
  "assetInputs": [
    {
      "match": { "kinds": ["video"] },
      "representations": ["provider-url"]
    }
  ]
}
```

This contract belongs to the selected binding, not to the executable function
or plugin manifest. The Host resolves it immediately before invocation. For a
URL-only binding, `context.reference` may publish the local Asset through the
active machine backend and return
`{ form: "provider-url", providerUrl, expiresAt, ... }`. The plugin does not
know whether the backend is user-owned R2/S3/TOS or future Clash-managed
storage. A binding that also accepts `bytes` does not authorize a new public
copy: the Host reuses an existing Provider URL when one exists and otherwise
delivers bytes.

## Typed outputs and uploads

Small results can be returned as typed media. For large bytes,
`context.upload` obtains a Host upload slot so the stdio result carries only a
canonical Asset handle. If the upstream already published a URL, pass that URL
to `context.upload` and let the Host ingest it according to Project policy.
`context.asset` is the lower-level small-result form for an inline base64 value
or Provider URL; both methods return the same canonical output handle and never
let the plugin choose a storage identity.

A completed Provider media result must return that handle as
`{ slot: "media", kind: "asset", asset: handle }`. The `value` channel is only
for JSON values such as the canonical text result
`{ slot: "text", kind: "value", value: "..." }`; a media URL or metadata object
in `value` is a contract violation.

These primitives keep local and hosted execution on one contract: plugin code
does not know the database path, object-store bucket, or project replica
layout.

## Host tools

Named Host functionality is declared under `contributes.hostTools`. For
example, `codex.imagegen` is available only to a plugin that explicitly
contributes it. Host tools are product integrations, not general I/O
declarations.

Declaring `codex.imagegen` authorizes the tool, not arbitrary Project reads.
Every image handle in its `references` array must match the Asset id and kind
of a frozen `invocation.input.references` entry. The tool's `slot` names its
output and is not an input-reference authorization field.

## Security model

Installing a plugin installs trusted code with the user's process privileges.
Review its source and package provenance as you would a CLI, editor extension,
or build plugin. The meaningful product boundary is the account/project scope
of Host-owned state. Instrumentation and traffic recording also attach at the
plugin process boundary; they are not business-code SDK dependencies.
