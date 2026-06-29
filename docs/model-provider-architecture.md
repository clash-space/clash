# Model Provider Architecture

Last updated: 2026-06-26

This document defines Clash's model/provider contract. The design is inspired
by OpenRouter's mental model: users choose a model, and the system resolves a
provider that can run it. Internally, providers declare the models they support;
the model catalog is an indexed view over those declarations.

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

Model cards do not own:

- API keys
- base URLs
- provider account state
- upstream endpoint details
- provider priority

The UI starts from model cards because that is how users think: "I want this
model or capability." The execution system then asks which provider can run
that model.

### Provider Definition

A provider definition is the execution adapter Clash knows how to operate.
Providers declare their supported models in reverse.

That means the provider is the source of truth for support:

```ts
type ProviderDefinition = {
  id: ProviderId;
  title: string;
  hosting: "clash-hosted" | "custom";
  auth: ProviderAuthSpec;
  supportedModels: ProviderModelSupport[];
};

type ProviderModelSupport = {
  modelId: string;
  upstreamModel: string;
  shape: ProviderShape;
  kind: "text" | "image" | "video" | "audio";
  priority?: number;
  requiredCredentials?: ProviderCredentialId[];
  requiredOAuth?: ProviderOAuthId[];
  parameterMap?: ProviderParameterMap;
};
```

The model catalog is built by indexing all `supportedModels` rows by
`modelId`.

This gives both directions:

- Provider page: "Kling official supports Kling 3."
- Model page: "Kling 3 can run on Kling official, fal.ai, and KIE."

The provider definition is authoritative because provider support changes by
API capability, region, account type, and endpoint availability. A model card
should not try to maintain those details.

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
  configuredCredentials?: ProviderCredentialId[];
  availableOAuth?: ProviderOAuthId[];
};
```

Provider accounts own:

- enabled/disabled state
- user-provided credential availability, for BYOK or custom providers
- region or channel
- routing priority and weight

Provider accounts do not declare model support directly. They select or enable
a provider definition that already declares support.

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

## Built-In vs Custom

### Built-In Provider

```ts
{
  id: "elevenlabs",
  title: "ElevenLabs",
  hosting: "clash-hosted",
  auth: { credentials: ["apiKey"] },
  supportedModels: [
    {
      modelId: "elevenlabs-tts",
      upstreamModel: "eleven_multilingual_v2",
      shape: "elevenlabs",
      kind: "audio",
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
  supportedModels: [
    {
      modelId: "gpt-5.4",
      upstreamModel: "gpt-5.4",
      shape: "openai-compatible",
      kind: "text",
    },
  ],
}
```

## Resolver Flow

The resolver starts with a model card id and modality.

```text
modelId + kind
  -> find provider support rows for modelId
  -> remove disabled provider accounts
  -> remove rows missing required credentials
  -> remove rows missing required OAuth/session providers
  -> apply user provider weights
  -> apply user provider order
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
- supported model count and modalities
- account credential state
- enable switch
- advanced routing controls

The provider page should not repeat the surrounding Settings title. The page
title already says `Providers`; the content should start with filters/search
and provider rows.

The bottom of the provider list should include `Add custom provider`.

`Add custom provider` should collect:

- provider name
- shape
- base URL
- API key secret
- supported model cards
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

The current code has route arrays shaped like model-to-provider entries. The
target shape should move toward provider definitions with reverse declarations.

Target source of truth:

```text
providerDefinitions[]
  provider.supportedModels[]
    modelId
    upstreamModel
    shape
```

Derived indexes:

```text
modelId -> provider support rows
providerId -> supported model rows
providerId/account -> availability
```

This keeps the product model-card-first while avoiding model cards becoming a
large provider compatibility matrix.

## Migration Plan

1. Introduce `ProviderShape` as its own schema.
2. Rename API-facing `apiShape` concepts to `shape` where possible.
3. Split provider identity from upstream/protocol shape.
4. Replace `OpenAI-compatible` and `Anthropic-compatible` provider rows with
   provider rows plus shape metadata.
5. Add `custom provider` definitions that can use compatible shapes.
6. Convert static route arrays into provider definitions.
7. Build model catalog entries by indexing `provider.supportedModels`.
8. Update generation registry to dispatch by resolved provider adapter.
9. Add tests for both directions:
   - model card resolves to all configured providers
   - provider page lists all supported model cards

## Non-Goals

- Do not make a fake Midjourney provider unless Midjourney exposes an official
  API contract Clash can call directly.
- Do not treat a shape as a provider identity.
- Do not let model cards own provider credentials.
- Do not require custom providers to be Clash-hosted.
