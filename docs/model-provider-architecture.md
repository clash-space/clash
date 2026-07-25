# Model Provider Architecture

Last updated: 2026-07-01

This document defines Clash's model/provider contract. The design is inspired
by OpenRouter's mental model: users choose a model, and the system resolves a
provider that can run it. Internally, model cards declare concrete provider
implementations; provider pages and model routing controls are reverse indexes
over those declarations plus the user's configured provider accounts.

## Goals

- Keep the product centered on model cards.
- Let one model be served by multiple providers.
- Let each provider account have its own keys, routing priority, and limits.
- Support custom providers without confusing them with Clash-hosted providers.
- Treat OpenAI-compatible, Anthropic-compatible, fal-shaped, and similar APIs
  as protocol shapes, not provider identities.
- Make the resolver deterministic, testable, and extensible.

## Core Concepts

### Model Card

A model card is the user-facing product object. It describes what the model
does and what inputs the UI must collect.

Examples:

- `seedance-2-ref`
- `kling-3`
- `minimax-tts`
- `elevenlabs-tts`
- `gpt-image-2`

Model cards own:

- display name
- modality: `text`, `image`, `video`, `audio`
- prompt/input requirements
- parameter schema shown in the UI
- default parameters
- product description
- provider implementation rows: provider identity, upstream endpoint id,
  adapter shape, credential/OAuth requirements, parameter mapping, and static
  fallback priority

Model cards do not own:

- API keys
- base URLs
- provider account state
- user provider priority
- per-model user priority overrides

The UI starts from model cards because that is how users think: "I want this
model or capability." The execution system then asks which provider can run
that model.

### Provider Definition

A provider definition is the execution adapter Clash knows how to operate.
It describes provider identity, hosting mode, setup requirements, and the UI
copy needed to configure accounts. It does not own model support.

```ts
type ProviderDefinition = {
  id: ProviderId;
  title: string;
  hosting: "clash-hosted" | "custom";
  auth: ProviderAuthSpec;
};
```

Model support is declared from the model card side:

```ts
type ModelProviderImplementation = {
  providerId: ProviderId;
  upstreamId: ModelUpstreamId;
  upstreamModel: string;
  apiShape: ProviderShape;
  priority?: number;
  requiredCredentials?: ProviderCredentialId[];
  requiredOAuth?: ProviderOAuthId[];
  parameterMap?: ProviderParameterMap;
};
```

The model catalog and provider detail pages are built by indexing all
`model.providerImplementations` rows.

This gives both directions from one source of truth:

- Provider page: "Replicate supports Nano Banana 2 and GPT Image 2."
- Model page: "GPT Image 2 can run on OpenAI, Replicate, and Mock."

Provider definitions are still authoritative for setup and execution identity:
API keys, OAuth methods, hosted/custom status, labels, and bounded account
configuration. They must not reintroduce a parallel `supportedModels` list.

### Provider Account

A provider account is the user's configured account or Clash's hosted account
availability for a provider definition.

```ts
type ProviderAccount = {
  providerId: ProviderId;
  enabled: boolean;
  region?: string;
  priority?: number;
  weight?: number;
  supportedModelIds?: string[];
  modelPriorities?: Record<string, number>;
  configuredCredentials?: ProviderCredentialId[];
  availableOAuth?: ProviderOAuthId[];
};
```

Provider accounts own:

- enabled/disabled state
- user-provided credential availability, for BYOK or custom providers
- region or channel
- routing priority and weight
- optional model allowlist for this account, selected from the model-card-derived
  provider support list
- optional per-model provider priority, so changing `gpt-image-2` routing does
  not change `flux-schnell` routing

Provider accounts do not invent model support directly. The provider
implementation rows declare the full support set; an account may only restrict
that set to a subset with `supportedModelIds`.

### Provider Shape

A provider shape is the wire protocol or adapter contract.

Examples:

- `openai-compatible`
- `anthropic-compatible`
- `openai-images`
- `google-ai-studio`
- `google-vertex`
- `fal`
- `replicate`
- `kling`
- `minimax`
- `modelark`
- `dreamina-cli`
- `elevenlabs`

OpenAI-compatible and Anthropic-compatible are shapes, not providers. A custom
provider may use either shape. Clash-hosted providers may also use those shapes
where appropriate.

This matters for UI naming:

- Bad: `OpenAI-compatible` as a provider row.
- Better: `OpenAI` provider row using the `openai-compatible` and
  `openai-images` shapes.
- Better: `Add custom provider` with a `Shape` selector containing
  `OpenAI-compatible` and `Anthropic-compatible`.

## Hosting Contract

Except for custom providers, built-in providers are Clash-hosted execution
adapters. A built-in provider is not a user-hosted endpoint. Even when a user
supplies a BYOK credential, Clash still owns the adapter and executes the
provider-specific request path.

Built-in provider definitions include official and managed adapters such as:

- OpenAI
- Anthropic
- Google
- fal.ai
- KIE
- Replicate
- Kling official
- MiniMax official
- Jimeng official
- Volcengine official
- ElevenLabs official

Current Seedance split:

- Volcengine official is the hosted/cloud ModelArk adapter. It reads
  `credentials.apiKey` and optional `credentials.baseUrl` from the user's
  saved provider account row. It does not read Worker, desktop process, or
  `user_variable` environment-style keys.
- Jimeng/Dreamina official is a local desktop adapter around the official
  Dreamina CLI. It is enabled by the `dreamina` OAuth/session record and uses
  the `dreamina-cli` shape. Clash must only launch the official CLI for this
  provider.

For built-in providers, Clash owns:

- the adapter implementation
- request/response mapping
- retries and polling
- media upload/download handling
- asset persistence
- provider-specific parameter mapping

The user may still supply keys for a built-in provider when BYOK is supported,
but the provider is not "custom" just because the key is user-owned. Built-in
providers should not expose arbitrary shape/base URL controls unless the
provider definition explicitly supports a bounded regional endpoint.

Custom providers are different. A custom provider is user-defined and
user-hosted:

- user chooses the shape
- user supplies base URL
- user supplies API key or secret binding
- user declares which model cards it can serve
- user maps Clash parameters to the provider's wire parameters

Current product scope is deliberately narrower than the eventual adapter
matrix: users can create custom **text** providers with either the
`openai-compatible` or `anthropic-compatible` shape, then create text model
cards and bind each card to one or more concrete provider accounts. Audio can
follow once a bounded request/parameter mapping is defined. Image and video do
not reuse the text compatibility switch.

## Built-In vs Custom

### Built-In Provider

```ts
{
  id: "elevenlabs",
  title: "ElevenLabs",
  hosting: "clash-hosted",
  auth: { credentials: ["apiKey"] },
}
```

The `elevenlabs-tts` model card owns the matching provider implementation row:

```ts
{
  id: "elevenlabs-tts",
  name: "ElevenLabs TTS",
  kind: "audio",
  providerImplementations: [
    {
      providerId: "elevenlabs",
      upstreamId: "elevenlabs",
      upstreamModel: "eleven_multilingual_v2",
      apiShape: "elevenlabs",
      requiredCredentials: ["apiKey"],
      priority: 10,
    },
  ],
}
```

### Custom Provider

```ts
{
  id: "custom:my-openai-proxy",
  title: "My OpenAI Proxy",
  hosting: "custom",
  shape: "openai-compatible",
  baseUrl: "https://proxy.example.com/v1",
  auth: { credentials: ["apiKey"] },
  modelImplementations: [
    {
      modelId: "gpt-5.4",
      upstreamModel: "gpt-5.4",
      apiShape: "openai-compatible",
      kind: "text",
    },
  ],
}
```

A custom provider cannot create a fake Clash model card by naming an upstream
model. It must map to an existing model card or create a real custom model card
with a UI contract, parameters, routing entry, and tests.

## Resolver Flow

The resolver starts with a model card id and modality.

```text
modelId + kind
  -> find model card providerImplementation rows for modelId
  -> remove disabled provider accounts
  -> remove provider accounts whose model allowlist excludes modelId
  -> remove rows missing required credentials
  -> remove rows missing required OAuth/session providers
  -> apply model-specific provider priority
  -> apply user provider weights and account order
  -> apply provider route priority
  -> return selected provider route
```

The route returned to execution should include:

```ts
type ResolvedProviderRoute = {
  modelId: string;
  kind: ModelKind;
  providerId: ProviderId;
  accountId?: string;
  upstreamModel: string;
  shape: ProviderShape;
  region?: string;
  parameterMap?: ProviderParameterMap;
};
```

The generation registry should switch on `providerId` or the resolved adapter,
not on model ids alone.

## Settings UX Contract

The Providers page should list provider definitions and account state.

Each row should show:

- provider logo/name
- hosted/custom badge
- configured state
- supported model count and modalities derived from model card implementations
- account credential state
- enable switch
- a single configure/manage entry point when account credentials are required

The provider page should not repeat the surrounding Settings title. The page
title already says `Providers`; the content should start with filters/search
and provider rows.

The bottom of the provider list should include `Add custom provider`.

`Add custom provider` should collect:

- provider name
- shape
- base URL
- API key secret
- supported model cards or real custom model cards
- upstream model id for each model card
- optional parameter mapping

This is the only place where users choose an arbitrary protocol shape. Built-in
rows should show provider names such as `OpenAI`, `Anthropic`, and
`ElevenLabs`, not shape names such as `OpenAI-compatible`.

The shape selector should include at least:

- OpenAI-compatible
- Anthropic-compatible
- fal-shaped
- Replicate-like prediction API, if supported

## Data Model Direction

Source of truth:

```text
modelCards[]
  model.providerImplementations[]
    providerId
    upstreamId
    upstreamModel
    apiShape
    credential/OAuth requirements
    static fallback priority
```

Derived indexes:

```text
modelId -> provider support rows
providerId -> supported model rows
providerId/account -> availability
```

This keeps model cards first-class and prevents a parallel provider-owned model
matrix from drifting out of sync. Provider definitions describe account setup
and execution identity; model cards describe which providers can execute the
model.

## Migration Plan

1. Introduce `ProviderShape` as its own schema.
2. Rename API-facing `apiShape` concepts to `shape` where possible.
3. Split provider identity from upstream/protocol shape.
4. Replace `OpenAI-compatible` and `Anthropic-compatible` provider rows with
   provider rows plus shape metadata.
5. Add `custom provider` definitions that can use compatible shapes.
6. Convert static route arrays into `model.providerImplementations`.
7. Build model catalog entries and provider detail support lists by indexing
   `model.providerImplementations`.
8. Update generation registry to dispatch by resolved provider adapter.
9. Add tests for both directions:
   - model card resolves to all configured providers
   - provider page lists all supported model cards

## Non-Goals

- Do not make a fake Midjourney provider unless Midjourney exposes an official
  API contract Clash can call directly.
- Do not treat a shape as a provider identity.
- Do not let model cards own provider credential values or secrets.
- Do not require custom providers to be Clash-hosted.
