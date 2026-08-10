# Manifest & Artifacts

## Manifest (`manifest.json`)

```json
{
  "apiVersion": "clash.plugin/v1",
  "id": "my-gateway-media",
  "version": "1.0.0",
  "name": "My Gateway Media",
  "description": "Third-party provider and bindings for the … catalog.",
  "runtime": { "kind": "local", "transport": "stdio", "entrypoint": "dist/handler.mjs" },
  "exports": {
    "cards": [],
    "providers": [
      { "id": "my-gateway", "kind": "provider", "path": "providers/my-gateway.json" }
    ],
    "modelBindings": [
      { "id": "my-kling-image-o1", "kind": "model-provider-binding", "path": "bindings/kling-image-o1.json" }
    ],
    "functions": [
      { "id": "my-gateway-execute", "kind": "provider-executor", "handler": "execute" }
    ]
  },
  "permissions": {
    "secrets": ["provider:my-gateway"],
    "network": { "domains": ["api.my-gateway.example"] },
    "externalWrites": true,
    "assets": ["read", "write"]
  }
}
```

- `version` gates activation: executable content cannot change without a bump.
- Every declared artifact path must exist — a missing file fails validation
  (`Missing declared … document`). Undeclared extra files are not rejected,
  but they feed the package content hash, so any change still forces a
  version bump.
- A provider's `executorExportId` must match a declared
  `functions[kind=provider-executor]` export — validation fails with
  `Provider <id> requires provider executor export <executorExportId>`
  otherwise (the example above pairs `my-gateway-execute` for exactly this
  reason).

### Permissions

| Key | Grants |
| --- | --- |
| `secrets: ["provider:<id>"]` | May request credential handles for that provider |
| `network.domains` | Broker fetch allowlist. Entries are bare hostnames: `example.com` matches itself **and every subdomain** (`host === domain \|\| host.endsWith('.' + domain)`). There is **no `*.` wildcard syntax** — a literal `*.example.com` entry never matches anything |
| `externalWrites` | Non-GET methods through the broker |
| `assets: ["read","write"]` | Project-scoped asset access via broker |
| `hostTools: ["codex.imagegen"]` | Host-run tool invocations |

Permission **increases** across versions surface to the user for confirmation
during activation; unchanged permissions don't re-prompt.

## Provider definition (`clash.provider/v1`)

```json
{
  "apiVersion": "clash.provider/v1",
  "kind": "provider",
  "spec": {
    "id": "my-gateway",
    "name": "My Gateway",
    "upstreamId": "my-gateway",
    "apiShape": "my-gateway",
    "executorExportId": "my-gateway-execute",
    "auth": [
      {
        "type": "oauth",
        "id": "my-gateway",
        "flow": "browser",
        "authorizationUrl": "https://gateway.example/login?device_id=clash-desktop",
        "callback": { "type": "custom-scheme", "scheme": "my-gateway" },
        "accessTokenField": "accessToken"
      },
      {
        "type": "local-token-import",
        "id": "my-gateway",
        "label": "Reuse existing desktop login",
        "source": {
          "format": "electron-store-aes-256-gcm-v2",
          "appDataSubdirectory": "@vendor/Product",
          "configFile": "config.json",
          "keyFile": ".token-key",
          "tokenPath": ["tokens", "accessToken"]
        }
      }
    ]
  }
}
```

### Credential sources

Every entry in `auth` answers one question — how does a credential for this
provider get here — and they differ along two axes the host reads:

| Entry | Control rendered | Needs a human present |
| --- | --- | --- |
| `api-key` | A field | No — can be provisioned ahead of time |
| `oauth` with `flow: "browser"` | A button that opens a window | **Yes** |
| `local-token-import` | A button that calls the host | No — reads an installed app |

Use `resolveCredentialSources()` from `@clash/shared-types` rather than picking
entries out by type name; it returns the list in declared order, so a provider may
offer two sources of the same kind (two regions, two installed clients) without one
shadowing the other.

::: tip Declare at least one unattended source
A provider whose only sources need a browser window or a third-party desktop app
cannot be configured from the CLI, from CI, or on a headless machine — and that
failure is invisible until a run fails. `hasUnattendedCredentialSource()` is the
check; an `api-key` entry is usually the fix, and needs no new host code because the
broker already injects `credentials.apiKey` as the bearer token.
:::

### `flow: "browser"` is a redirect capture, not OAuth 2.0

Despite the field name, this flow is not an OAuth grant. It carries no
`response_type`, `client_id`, or `token_type`, and `accessTokenField` is
configurable — which only makes sense absent a standard, since RFC 6749 fixes that
name as `access_token`. What actually happens: the host opens the vendor's login
page in its own `BrowserWindow`, intercepts the navigation to your custom scheme,
and reads the token out of the callback URL.

That has two consequences worth knowing:

- The scheme is intercepted **inside Clash's window** (`will-navigate`), never
  registered with the OS, so it does not conflict with the vendor's own desktop app.
- The token transits a URL. Prefer `api-key` or `local-token-import` when the vendor
  offers either.

### Acquisition is host-implemented, and the set is closed

Git, Docker, AWS, and kubectl all let a credential helper be an arbitrary command.
They can, because **the user configures it**. Here a third-party plugin declares it,
and acquisition needs privileges the sandbox denies outright — reading another
application's app-data, decrypting its store, intercepting a browser window. So the
host implements each acquisition kind and the manifest only selects one and supplies
its parameters. A plugin cannot ship its own credential-acquisition code.

`local-token-import` reuses a login the user already has in another desktop
app. This is powerful and privacy-sensitive: the user must be able to see
which app's login is being reused (the `label` renders in UI), and imported
tokens are encrypted at rest in the host's provider store. The plugin never sees
the token: the broker injects the authorization header on its behalf and strips
credential-bearing headers the plugin tries to set itself.

## Model bindings

See [Model Cards, Providers & Bindings](/guide/model-cards) for the schema and
the three override tools (`parameterOverrides`, `defaultParamOverrides`,
`excludedParameterIds`).

## Handler contract

The `entrypoint` is an ESM bundle (`.mjs`) or a Python module (`.py` — see
[Python SDK](/sdk/python-sdk) for `clash_sdk.executable.serve` and the
interpreter/sandbox specifics). For provider executors, handle
`clash.plugin.invoke/v1` with `target.kind === "provider-executor"` and your
`executorExportId`. Input values carry `modelId`, `upstreamModel`, `prompt`,
`duration`, `aspectRatio`, `modelParams`, and reference URL arrays
(`referenceImageUrls`, `referenceVideoUrls`, `referenceAudioUrls`,
`startFrameUrl`, `endFrameUrl`). Return `clash.plugin.result/v1` with
`status: "completed"` and outputs (URL + `contentType` + optional
`durationMs`), or `status: "failed"` with a real error message.

## Asset references

A plugin never receives a file path or a storage location. It receives a
`clash-asset://<id>` handle and resolves it through the broker:

```ts
import { resolveAssetReference } from "@clash/action-sdk";

const reference = await resolveAssetReference(context, handle);
if (reference.form === "url" && reference.forwardable) {
  body.image_url = reference.url;                       // the provider fetches it
} else {
  body.image_url = await uploadToProvider(reference);   // we hand the bytes over
}
```

The host supplies whatever it has. A local host reads the file and answers with bytes; a
hosted one whose assets already live in object storage answers with a URL and moves no
bytes at all. Nothing in the plugin distinguishes those two worlds, and nothing should:
that is what keeps local, synced, and shared a single workflow.

### The two axes are independent

How we can supply an asset and what a provider accepts are unrelated:

|                    | provider takes bytes | provider fetches a URL | provider has an upload endpoint |
| ------------------ | -------------------- | ---------------------- | ------------------------------- |
| we hold a file     | inline it            | **impossible**         | POST the bytes, use the URL     |
| we hold a URL      | fetch, then inline   | forward it             | forward, or fetch and POST      |

Only the plugin author knows the column, because only they know the upstream. So the SDK
states our side exactly and leaves the choice alone.

### Declare the forms you accept

```json
{ "assetForms": ["bytes", "url"] }
```

This is the plugin's half of the protocol, and the host enforces it. Bytes are the default,
because every host can read a file. Add `url` when the plugin can take a URL and either
forward it or fetch it — then a host whose asset is already published hands the URL over and
moves no bytes at all.

The host picks from the intersection and prefers `url`, so declaring both is what makes the
hosted path cheap. When the two sides share nothing the request is refused by name:

```
Plugin and host share no asset form for local-gen-1; the plugin accepts url and
this host can supply bytes.
```

Without the declaration there is no agreement, only a hope. A plugin that implements just
the URL path would install cleanly, list its models as `available`, and fail every local
generation — the same hole as a plugin whose only credential sources need a human present,
which left headless hosts with no path at all and stayed invisible until a run failed.

::: tip Declare forms, not environments
`assetForms` says what the plugin can consume, never where it runs. Which forms it can take
follows from the upstream it talks to; a "local" or "cloud" flag would fork the single
workflow that local, synced, and shared share, and the host already knows which forms it can
supply.
:::

### `forwardable` is not cosmetic

A local asset served on loopback and a published asset are both `https?://` strings, so
nothing downstream can tell them apart by inspection. Forwarding the first hands the
provider an address that answers for somebody else on its own network. The broker states
the reach and the SDK surfaces it as `forwardable`; a plugin that forwards a URL without
checking it is relying on luck.

The installed `hilo-hub-media` plugin shows the failure mode this replaces. It tests

```ts
if (/^https?:\/\//i.test(value) || value.startsWith("asset://")) return value;
```

against a host that emits `clash-asset://`, so the handle branch has never run, and any
`https?://` — including a loopback one — is forwarded unchecked. A typed entry point
removes the class of mistake instead of the instance.
