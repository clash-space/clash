# Manifest & Artifacts

## Manifest (`manifest.json`)

```json
{
  "apiVersion": "clash.plugin/v1",
  "id": "acme.media",
  "version": "1.0.0",
  "name": "Acme Media",
  "description": "Acme provider and model bindings.",
  "runtime": {
    "kind": "local",
    "transport": "stdio",
    "entrypoint": "dist/stdio.mjs"
  },
  "contributes": {
    "cards": [],
    "providers": [
      { "id": "acme", "kind": "provider", "path": "providers/acme.json" }
    ],
    "modelBindings": [
      {
        "id": "acme-kling-image-o1",
        "kind": "model-provider-binding",
        "path": "bindings/kling-image-o1.json"
      }
    ],
    "functions": [
      {
        "id": "acme-execute",
        "kind": "provider-executor",
        "operations": ["submit", "poll"]
      }
    ],
    "hostTools": []
  },
  "contractTests": ["contract-tests/acme-submit.json"]
}
```

`contributes` is the only contribution table. Unrecognized manifest fields are
rejected.

- `version` gates activation: executable content cannot change without a
  version bump.
- Every declared artifact path must exist. Every packaged file participates in
  the content hash.
- A Provider's `executorExportId` must match a contributed
  `provider-executor` function.
- Declare the lifecycle arms the entrypoint implements in `operations`.
  `submit` is the default; callbacks also require `poll` as a fallback.
- `hostTools` is for named Host functionality such as `codex.imagegen`. It is
  an explicit product contribution.

Clash dependencies follow from contributions. A provider executor or action
receives scoped state and asset primitives; a pure projector does not need
vendor I/O. This is dependency wiring rather than a domain declaration.

## Provider definition (`clash.provider/v1`)

```json
{
  "apiVersion": "clash.provider/v1",
  "kind": "provider",
  "spec": {
    "id": "acme",
    "name": "Acme",
    "upstreamId": "acme",
    "apiShape": "acme",
    "executorExportId": "acme-execute",
    "auth": {
      "methods": [
        {
          "id": "token",
          "label": "API token",
          "form": [
            {
              "kind": "field",
              "key": "apiKey",
              "label": "API token",
              "secret": true
            }
          ]
        }
      ]
    }
  }
}
```

Authentication declarations tell the Host how to configure an account. The
Host stores the selected account's values and scopes `context.store` to it.
The executor reads only the keys its declaration names:

```ts
const apiKey = await context.store?.get("apiKey");
if (!apiKey) throw new Error("This Acme account has no apiKey stored.");

const response = await globalThis.fetch("https://api.acme.example/generate", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(request),
});
```

Do not accept credentials from `invocation.input.values`. Invocation values
describe the generation request; they do not select or authorize an account.

## References and outputs

Use the SDK context instead of guessing Host storage paths:

```ts
const reference = await context.reference?.(invocation.input.references[0]);

if (reference?.form === "bytes") {
  await sendBytesToVendor(reference.bytes, reference.mediaType);
} else if (reference?.form === "url") {
  await sendUrlToVendor(reference.url);
}
```

The plugin decides how to adapt the resolved form to its vendor. For results,
return typed media or use `context.upload` for large bytes. The Host persists
the asset and returns the canonical Clash handle.

Local, synced, and shared projects use the same plugin code. Only the Host
implementation of store/reference/upload changes.

## Build declarations

A TypeScript draft may declare:

```json
{
  "runtime": {
    "kind": "local",
    "transport": "stdio",
    "language": "node",
    "entrypoint": "dist/stdio.mjs",
    "build": { "source": "src/stdio.ts" }
  }
}
```

`clash plugin validate` and `activate` build that source from the repository's
single CLI build path. Python entrypoints are authored directly and omit
`runtime.build`.
