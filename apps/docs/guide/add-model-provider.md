# Tutorial: Add a Model, a Provider, or Both

Three onboarding paths, from most common to least. All of them end at the same
gate: `clash action validate` → `clash action activate` → verify in the
composed catalog.

## Path A — new provider for models Clash already has

You run (or resell) a gateway that serves e.g. Kling or Seedream. The cards
already exist; you ship **a provider + bindings + an executor**, zero cards.

### 1. Scaffold

```sh
clash action init-plugin ~/.clash/drafts/acme-media \
  --id acme-media --name "Acme Media" --kind provider-projector
```

### 2. Declare the provider (`providers/acme.json`)

```json
{
  "apiVersion": "clash.provider/v1",
  "kind": "provider",
  "spec": {
    "id": "acme",
    "name": "Acme Gateway",
    "upstreamId": "acme",
    "apiShape": "acme",
    "executorExportId": "acme-execute",
    "auth": [{ "type": "oauth", "id": "acme", "flow": "browser",
      "authorizationUrl": "https://acme.example/login",
      "callback": { "type": "custom-scheme", "scheme": "acme" },
      "accessTokenField": "accessToken" }]
  }
}
```

### 3. Bind existing cards (`bindings/<model>.json`, one per model)

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
    "requiredOAuth": ["acme"],
    "priority": 5
  }
}
```

Find existing card ids with `clash models catalog` or the
`/api/v1/models/catalog` endpoint. Declare per-provider quirks in the binding
(`parameterOverrides` / `defaultParamOverrides` / `excludedParameterIds` — see
[Model Cards](/guide/model-cards)); never rewrite values inside the executor.

### 4. Wire the manifest

`exports.providers` + `exports.modelBindings` + a
`functions[kind=provider-executor]` whose `id` equals `executorExportId`, plus
permissions (`secrets: ["provider:acme"]`, `network.domains`,
`externalWrites`). Full example in [Manifest & Artifacts](/plugins/manifest).

### 5. Executor, contracts, activate

Write the stdio executor against broker fixtures
([Authoring Workflow](/plugins/authoring) steps 3–6), add one contract test
per API family, then:

```sh
clash action validate ~/.clash/drafts/acme-media
clash action activate ~/.clash/drafts/acme-media
curl "$HOST/api/v1/models/catalog"   # your provider now appears on each bound card
```

## Path B — new model that no card covers yet

Ship the card **inside your plugin** under the official model name:

1. Create `cards/<official-model-id>.json` (`apiVersion: clash.card/v1`,
   `kind: model-card`). Copy the structure from an existing card of the same
   modality; source every enum from the model's official API docs.
2. Declare it in `exports.cards`:
   ```json
   "cards": [{ "id": "official-model-id", "kind": "model-card", "path": "cards/official-model-id.json" }]
   ```
3. Add a binding from that card to your provider exactly as in Path A —
   the binding is what makes the card runnable.

Naming rules (enforced in review, not by schema): official model name only,
no provider/gateway flavor in the id, no invented tiers — if the upstream has
no "pro" variant, there is no "-pro" card.

`clash action init-plugin --kind provider-projector` scaffolds a working
card + provider + contract set to start from.

## Path C — first-party card (core catalog)

Only for models Clash should ship by default: add the card to
`plugins/first-party-media/cards/` (or `MODEL_CARDS` in
`@clash/shared-types` for built-ins) in the main repo via PR. Third parties
should always prefer Path B.

## Verify any path landed

```sh
clash models catalog | jq '.models[] | select(.model.id=="<card-id>")
  | {providers: [.model.providerImplementations[].providerId],
     candidates: .candidateProviders, route: .selectedRoute.providerId}'
```

Your provider must appear in `providers`; with credentials configured it
should appear in `candidates`; with the best priority it becomes the `route`.
