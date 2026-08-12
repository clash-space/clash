# Host-scoped SDK Context

Plugins are normal processes and own their external I/O. Clash injects only
the dependencies that belong to Clash itself: account state, project
references, asset persistence, and explicitly contributed Host tools.

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
domain list. The plugin owns redirects, retries, polling, uploads, downloads,
and vendor error parsing.

## Typed references

`context.reference(reference)` resolves a Clash reference without exposing a
storage path. It returns one of the forms the Host can supply:

- bytes plus media type;
- a URL plus reach metadata;
- text.

The plugin chooses the vendor-specific adaptation: inline the bytes, forward a
public URL, or upload either form to the vendor first. Do not infer reach from
whether a string starts with `http`.

## Typed outputs and uploads

Small results can be returned as typed media. For large byte streams,
`context.upload` asks the Host for storage and returns a canonical asset
output. If the upstream already published a URL, return the URL form and let
the Host persist it according to project policy.

These primitives keep local and hosted execution on one contract: plugin code
does not know the database path, object-store bucket, or project replica
layout.

## Host tools

Named Host functionality is declared under `contributes.hostTools`. For
example, `codex.imagegen` is available only to a plugin that explicitly
contributes it. Host tools are product integrations, not general I/O
declarations.

## Security model

Installing a plugin installs trusted code with the user's process privileges.
Review its source and package provenance as you would a CLI, editor extension,
or build plugin. The meaningful product boundary is the account/project scope
of Host-owned state.
