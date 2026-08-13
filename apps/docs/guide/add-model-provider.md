# Tutorial: Add a Model, a Provider, or Both

All paths end at the same gate:

```sh
clash plugin validate <dir>
clash plugin activate <dir>
```

## Path A — add a provider for existing models

Use this when a gateway serves models already present in Clash.

### 1. Scaffold

```sh
clash plugin create ~/plugins/acme-media \
  --id acme.media --name "Acme Media" --kind provider-executor
```

### 2. Declare account configuration

Create `providers/acme.json`:

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

The Host stores these values for the selected account. The executor reads
`await context.store.get("apiKey")`; it does not accept credentials in
invocation values.

### 3. Bind existing cards

Create one `clash.binding/v1` document per supported model:

```json
{
  "apiVersion": "clash.binding/v1",
  "kind": "model-provider-binding",
  "spec": {
    "id": "acme-kling-image-o1",
    "modelId": "kling-image-o1",
    "providerId": "acme",
    "upstreamId": "acme",
    "upstreamModel": "kling-image-o1",
    "apiShape": "acme",
    "executorExportId": "acme-execute",
    "priority": 5
  }
}
```

Keep provider-specific parameter spellings in the binding or executor. Do not
change shared card values to match one vendor.

### 4. Wire `contributes`

```json
{
  "contributes": {
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
    ]
  }
}
```

The contribution declares the product shape. The plugin is ordinary installed
code and owns its external I/O.

### 5. Implement the executor

Use the Action SDK's typed executor shape:

- read account state from `context.store`;
- resolve Clash references with `context.reference`;
- on `submit`, make at most one upstream submission;
- on `poll`, make at most one status request for the supplied opaque
  `pollState`;
- return typed text/media or stream large bytes through `context.upload`;
- keep `pollState` credential-free and serializable; and
- return only `completed`, `accepted`, or `failed`. Every failure must carry a
  canonical `code`, `retryable`, and `requestState`.

The plugin must not loop, sleep, retry, select another account, persist task
state, or publish a Project Asset. The Host owns those policies and invokes the
executor again when a retry or poll is due. Read
[Waiting for a Provider](/plugins/waiting) for the complete status/error table
and [Durable Run Protocol](/guide/durable-run-protocol) for Host checkpoints,
deadlines, recovery, and the design-only Cloud adapter.

Media declarations are assertions, not authority. Bytes returned through the
upload broker must actually decode as the declared Asset kind and media type.
After the completed result is checkpointed, the Host stages the immutable
Resource and runs its versioned byte probe before Project publication. A
temporary probe failure retries finalization from staged bytes without invoking
the Provider again; malformed media eventually fails the run and cannot create
a Project Asset or output binding.

### 6. Test and activate

Add deterministic contract cases for request/response projection. Then run a
real backend case for every exposed family, record redacted traffic at the
plugin process boundary, and commit the offline replay as a regression test
fixture. Traffic capture belongs to test instrumentation around the plugin
process; it must not add recording branches to Provider business code.

```sh
clash plugin validate ~/plugins/acme-media
clash plugin activate ~/plugins/acme-media
```

## Path B — add a new model card

If no existing card describes the model:

1. Create `cards/<official-model-id>.json` using the upstream's official
   values.
2. Add it to `contributes.cards`.
3. Add a binding from that card to the provider.

```json
{
  "id": "official-model-id",
  "kind": "model-card",
  "path": "cards/official-model-id.json"
}
```

Use official model names and published parameter values. Do not invent a
shared resolution tier or provider-branded card id.

## Path C — change the bundled catalog

Only use the core catalog for models Clash should ship by default. Third-party
packages should contribute their card and binding from the plugin so they can
version and test the whole route together.

## Verify the composed route

```sh
clash models catalog | jq '.models[] | select(.model.id=="<card-id>")
  | {providers: [.model.providerImplementations[].providerId],
     candidates: .candidateProviders, route: .selectedRoute.providerId}'
```

The provider must appear in `providers`; after an account is configured it
should appear in `candidates`; routing priority determines the selected route.
