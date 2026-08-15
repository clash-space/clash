# Model Cards, Providers & Bindings

::: tip Looking for the walkthrough?
This page is the contract reference. For the step-by-step "I want to add a
model / provider" recipe, see
[Tutorial: Add a Model or Provider](/guide/add-model-provider).
:::

The three artifacts have strict, distinct responsibilities. Getting this split
right is what keeps one model usable across many providers.

## Model card — the provider-neutral contract

One card per model, named after the **official model name** (never after a
provider or gateway). The card declares:

- `id`, `aliases`, `name`, `kind` (`image | video | audio | text`). ASR cards
  are text-output cards identified by an exact audio input plus an `asr_model`
  runtime parameter; `asr` is not a separate output kind.
- `parameters` — the user-facing vocabulary (`select | slider | number | text |
boolean`, with `options`/`min`/`max`/`step`)
- `defaultParams`, `defaultAspectRatio`
- `input` — prompt/reference requirements and **official media constraints**
  (mime types, dimension ranges, per-clip and total duration, byte limits)
- `availableProviders`, `defaultProvider`, `providerImplementations`
- `maxRuntimeMs`

Card values must come from the **official upstream documentation**, not from
one gateway's behaviour. Example: `minimax-h3` declares `duration` 4–15,
`resolution` `768P | 2K`, and ratio options including `adaptive` — exactly the
official MiniMax-H3 enums.

### Parameter-conditioned reference constraints

When a user-facing parameter changes the model's reference contract, keep one
model card and declare the condition under the affected reference modality.
Do not create a second card for what is only a mode switch, and do not hide the
rule in a provider adapter. For example, Seedance 2.5 keeps Edit on
`seedance-2.5-ref` and declares the captured edit-video floor like this:

```ts
videos: {
  max: 10,
  constraints: { /* ordinary reference-video limits */ },
  conditional: [{
    when: [{ field: "modelParams.edit_mode", equals: true }],
    min: 1,
    max: 1,
    constraints: {
      minPixels: 407_696,
      minDurationMs: 4_000,
      maxDurationMs: 30_000,
    },
  }],
}
```

A matching conditional rule overrides only the fields it declares; all other
base bounds and media constraints remain in effect. The shared reference
validator evaluates the same rule in GUI, CLI/MCP payload construction, local
execution, and hosted execution.

The GUI revalidates immediately when the model or a relevant parameter changes.
It keeps the attached references, displays the concrete incompatibility, and
disables Run until the inputs are valid. It must never silently detach an asset
to make a switch pass. Local and hosted Hosts repeat the validation immediately
before dispatch so non-GUI callers have the same contract.

## `ratio + resolution = size`

A generated frame has two independent properties: the shape the caller composed
for, and how much pixel area to spend. Some providers expose them as one field
(`1024x1536`, `auto_2K`, `square_hd`, `1:1 HD`), which forces the user to pick a
shape and a size in a single control and makes "same frame, higher quality"
unreachable. Image cards therefore split that field:

| Parameter      | Means                   | Values                                                          |
| -------------- | ----------------------- | --------------------------------------------------------------- |
| `aspect_ratio` | The frame's shape       | Canonical `W:H`, plus the provider's own sentinel if it has one |
| `resolution`   | How much area to render | **Exactly the options the provider publishes**                  |

### Ratio is one quantity; resolution is a menu

These two look symmetric and are not, which is the single most important thing on
this page.

A ratio is a geometric fact with a canonical form. `landscape_16_9`,
`16:9`, and fal's `square_hd` are spellings of a shape, so the card states `16:9`
and the adapter spells it however its provider wants.

A resolution is **not** one quantity with several spellings — it is a list of
concrete outputs whose names are already exact. `720p` is 1280×720. `fhd` is
1920×1080. `768P` is what MiniMax calls its own rung. Cards carry those values
verbatim and **no adapter rewrites them**.

::: danger Never map resolution names onto a shared ladder
A "canonical" `0.5K/1K/2K/4K` ladder with `720p → 1K` asserts an equality that is
false: a 1K budget is 1048576 pixels while 720p is 921600. Folding one into the
other silently changes the frame the user asked for, discards the exact dimensions,
and adds a translation layer in every adapter that can drift independently.

Providers do not agree on how many rungs they offer or what to call them —
`720p/1080p`, `480p/720p`, `768P/2K`, `hd/fhd`, `0.5K/1K/2K/4K` are five real
menus. Squeezing them into one vocabulary guarantees lossy collisions.
:::

### When the product must compute a size

Some providers accept arbitrary dimensions rather than a menu. `gpt-image-2` takes
any size meeting four documented constraints: every edge ≤ 3840, both edges a
multiple of 16, long:short ≤ 3:1, and total pixels in [655360, 8294400]. There is
no option list to pass through, so the product has to choose — and _that_ is when a
ratio and a tier are multiplied into a concrete `width × height`.

Two rules make this safe:

- **A tier is a pixel budget, not a long edge.** At a fixed 2048 long edge, 1:1 is
  4.2 MP but 3:1 is only 1.4 MP, so a long-edge target delivers a fraction of the
  intended area at wide ratios.
- **Commit the table, don't compute at request time.** `GPT_IMAGE_SIZES` in
  `@clash/shared-types` is a committed ratio × tier → size table. A wrong cell shows
  up in a diff; a wrong formula shows up as a provider 400 or a silently reframed
  image. Every route that can serve the model reads the same table, so one request
  cannot return two different frames depending on which route took it.

## Provider implementation — how one provider serves the card

Inline in the card (first-party) or contributed by a plugin binding
(third-party). Both use the same schema:

```ts
{
  providerId: string,
  upstreamId?: string,
  upstreamModel: string,        // the provider's own model identifier
  apiShape: string,
  priority?: number,            // lower wins
  requiredCredentials?: string[],
  requiredOAuth?: string[],
  referenceBinding?: …,         // how inline references bind to prompt text
  parameterOverrides?: ModelParameter[],
  defaultParamOverrides?: Record<string, string | number | boolean>,
  excludedParameterIds?: string[],
}
```

### The three override tools

| Field                   | Use when                                                          | Real example¹                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parameterOverrides`    | The provider accepts a **different value domain** for a parameter | Kling via one gateway rejects `1K`/`2K` uppercase; the binding overrides resolution options to `1k`/`2k` while labels stay `1K`/`2K`                 |
| `defaultParamOverrides` | The card default is invalid or suboptimal **on this provider**    | MiniMax-H3 text-to-video rejects `ratio: adaptive`; the in-repo fal implementation overrides the default to `16:9`, and gateway bindings do the same |
| `excludedParameterIds`  | The provider **cannot serve** a parameter at all                  | A gateway that ignores `voice_id` excludes it so the UI never renders a dead control                                                                 |

¹ All examples are in-tree. The MiniMax H3 base card and fal implementation live in
`packages/shared-types/src/models.ts`; the fal binding overrides `aspect_ratio` to `16:9`.
The Hilo gateway repeats that override in
`plugins/hrhrng-hub/bindings/minimax-h3.json`. Its Kling value-domain example is in
`plugins/hrhrng-hub/bindings/kling-image-o1.json`, and its excluded-parameter examples include
`plugins/hrhrng-hub/bindings/kling-video-o1.json` and
`plugins/hrhrng-hub/bindings/seed-audio-1.json`.

Parameters absent from `parameterOverrides` are reused from the base card. The
canonical card remains the full product capability union: a provider-only
control still belongs on the card, while providers that cannot honor it name it
in `excludedParameterIds`.

The catalog keeps that full parameter surface. It reports
`unavailableParameterIds` only when every enabled provider account configured
for the model excludes the control, so the UI can disable the control instead
of hiding product capability. For an invocation, every materially supplied
parameter filters the route candidates; a route that excludes any requested
parameter cannot be selected. Empty text is not material, while `false` is an
explicit boolean choice.

After route selection, the runtime derives an effective card for validation by
removing that route's excluded parameters and applying its overrides. This is
the only reduced card: catalog and authoring surfaces continue to use the full
canonical card.

`ModelCardSchema` validates the relationship formally. Override, default, and
exclusion ids must reference canonical parameters; ids must be unique; one
provider cannot both override and exclude the same parameter; excluded
parameters cannot receive provider defaults; and provider defaults must satisfy
the effective parameter's type, candidates, and numeric range.

### Don't fix vocabulary in executor code

If a provider needs `2k` instead of `2K`, declare it in the binding. An
executor that rewrites values (`toLowerCase()` etc.) hides the contract,
diverges from what the UI shows, and breaks the next provider that needs the
opposite. The same applies to a provider's sentinel: MiniMax spells "match the
reference" as `adaptive`, so the card says `adaptive`. Renaming it to a
house-style `auto` and translating it back in the adapter moves a value the UI
shows into code the UI cannot see. Parameter-conditioned input bounds and media
requirements belong in the card's conditional reference constraints. An
executor may still defend an upstream-only request invariant, but it must not
be the first place a product-visible input rule exists.

## Plugin model binding — the external implementation

A binding artifact is `{ id, modelId } ∩ ModelProviderImplementation`:

```json
{
  "apiVersion": "clash.binding/v1",
  "kind": "model-provider-binding",
  "spec": {
    "id": "acme-kling-image-o1",
    "modelId": "kling-image-o1",
    "providerId": "acme-gateway",
    "upstreamModel": "kling-image-o1",
    "apiShape": "acme-gateway",
    "executorExportId": "acme-execute",
    "requiredOAuth": ["acme-gateway"],
    "priority": 5,
    "parameterOverrides": [
      {
        "id": "resolution",
        "label": "Resolution",
        "type": "select",
        "options": [
          { "label": "1K", "value": "1k" },
          { "label": "2K", "value": "2k" }
        ],
        "defaultValue": "2k"
      }
    ],
    "defaultParamOverrides": { "resolution": "2k" }
  }
}
```

Rules:

- `modelId` must reference an existing card. If none exists, add a card under
  the **official model name** first — never mint a provider-flavoured card id.
- Do not invent tiers. If the provider has no equivalent of a card (e.g. no
  "pro" tier upstream), don't bind that card at all.
- Match the card's family semantics: a "fast" card must map to the provider's
  fast tier, not whatever id looks similar.

## Composition and routing

Activated bindings merge into cards at catalog composition time
(`composeExecutablePluginModelCards`). Verify the result live:

```sh
curl "$(clash host status --json | jq -r .endpoint)/api/v1/models/catalog"
```

Each entry exposes the composed `model` (with merged
`providerImplementations`), `candidateProviders`, and `selectedRoute`.
