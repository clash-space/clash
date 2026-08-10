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

- `id`, `aliases`, `name`, `kind` (`image | video | audio | text | asr`)
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

## `ratio + resolution = size`

A generated frame has two independent properties: the shape the caller composed
for, and how much pixel area to spend. Some providers expose them as one field
(`1024x1536`, `auto_2K`, `square_hd`, `1:1 HD`), which forces the user to pick a
shape and a size in a single control and makes "same frame, higher quality"
unreachable. Image cards therefore split that field:

| Parameter | Means | Values |
| --- | --- | --- |
| `aspect_ratio` | The frame's shape | Canonical `W:H`, plus the provider's own sentinel if it has one |
| `resolution` | How much area to render | **Exactly the options the provider publishes** |

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
no option list to pass through, so the product has to choose — and *that* is when a
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

| Field | Use when | Real example¹ |
| --- | --- | --- |
| `parameterOverrides` | The provider accepts a **different value domain** for a parameter | Kling via one gateway rejects `1K`/`2K` uppercase; the binding overrides resolution options to `1k`/`2k` while labels stay `1K`/`2K` |
| `defaultParamOverrides` | The card default is invalid or suboptimal **on this provider** | MiniMax-H3 text-to-video rejects `ratio: adaptive`; the in-repo fal implementation overrides the default to `16:9`, and gateway bindings do the same |
| `excludedParameterIds` | The provider **cannot serve** a parameter at all | A gateway that ignores `voice_id` excludes it so the UI never renders a dead control |

¹ The fal example ships in this repo
(`plugins/first-party-media/cards/minimax-h3.json`). The Kling and gateway
binding examples come from a third-party gateway plugin distributed outside
this repository; they were verified against the live upstream but you will
not find those binding files in-tree.

Parameters absent from `parameterOverrides` are reused from the base card.
Excluded parameters are removed from the effective card instead of being
rendered and silently discarded.

### Don't fix vocabulary in executor code

If a provider needs `2k` instead of `2K`, declare it in the binding. An
executor that rewrites values (`toLowerCase()` etc.) hides the contract,
diverges from what the UI shows, and breaks the next provider that needs the
opposite. The same applies to a provider's sentinel: MiniMax spells "match the
reference" as `adaptive`, so the card says `adaptive`. Renaming it to a
house-style `auto` and translating it back in the adapter moves a value the UI
shows into code the UI cannot see. Executors may only enforce **conditional** upstream rules that a
static default cannot express (e.g. H3 rejects `adaptive` only when the request
has no references).

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
    "parameterOverrides": [{
      "id": "resolution", "label": "Resolution", "type": "select",
      "options": [
        { "label": "1K", "value": "1k" },
        { "label": "2K", "value": "2k" }
      ],
      "defaultValue": "2k"
    }],
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
