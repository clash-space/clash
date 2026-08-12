# Seedance provider parameter snapshots

> Historical research note: the direct KIE and Dreamina integrations described
> below have been retired and are not advertised or executed by Clash. Their
> snapshots remain here only as local upstream evidence for past routing
> decisions.

Captured on 2026-08-12 (Asia/Shanghai). These are local, reviewable excerpts of
the upstream contracts used to decide Clash Model Card values. They are not a
replacement for the linked upstream documentation.

## Result

`duration=auto` and `aspect_ratio=auto` are Clash product semantics. A provider
adapter may translate them only when the provider has the same behavior. It
must not turn `auto` into an arbitrary fixed value.

| Clash route                                            | Upstream duration auto | Upstream ratio auto | Wire spelling / evidence                                                                                                                     |
| ------------------------------------------------------ | ---------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Volcengine ModelArk, Seedance 2.0 / 2.5                | Yes                    | Yes                 | `duration=-1`; `ratio=adaptive`                                                                                                              |
| fal.ai, Seedance 2.0 reference / image-to-video        | Yes                    | Yes                 | `duration=auto`; `aspect_ratio=auto`                                                                                                         |
| Replicate, Seedance 2.0                                | Yes                    | Yes                 | `duration=-1`; `aspect_ratio=adaptive`                                                                                                       |
| KIE, Seedance 2.0                                      | **No**                 | Yes                 | duration is integer 4–15; `aspect_ratio=adaptive`                                                                                            |
| Dreamina CLI (`jimeng`), Seedance 2.0 multimodal/text  | **No**                 | **No**              | duration is integer 4–15; ratio is one of six fixed ratios                                                                                   |
| Dreamina CLI (`jimeng`), Seedance 2.0 first/last frame | **No**                 | Inferred only       | duration is integer 4–15; ratio is inferred from the first frame and is not an argument                                                      |
| Pika API Club, Seedance 2.0                            | Unverified             | Unverified          | Current Clash adapter sends `auto`, but the catalog endpoint timed out during this capture; do not treat implementation as upstream evidence |

The currently installed Dreamina CLI help also documents only
`seedance2.0` / `seedance2.0fast` for `multimodal2video`. Therefore the registered
`jimeng` Seedance 2.5 route is not verified by this local CLI contract.

## Volcengine ModelArk

Sources:

- <https://docs.volcengine.com/docs/82379/2607688?lang=zh>
- <https://docs.volcengine.com/docs/82379/2291680?lang=zh>

The Seedance 2.5 tutorial's capability table states:

```text
Seedance 2.5 output duration: 4~30 seconds; -1 (model selects the best duration)
Seedance 2.0 output duration: 4~15 seconds; -1 (model selects the best duration)

Output aspect ratio:
21:9, 16:9, 4:3, 1:1, 3:4, 9:16, adaptive
```

It additionally requires `ratio=adaptive` for first/last-frame tasks, editing,
and extension. Editing requires `duration=-1`; extension allows `[4, 30]` or
`-1` for Seedance 2.5.

The older Seedance 2.0 tutorial has a conflicting summary table that lists only
4–15 seconds and fixed ratios, while later examples and troubleshooting text
use `ratio=adaptive`. The newer Seedance 2.5 capability table explicitly covers
both 2.0 and 2.5 and is the source used for the matrix above. This conflict must
remain visible rather than silently collapsed.

### Clash integration snapshot

The supported first-party path is the standard executable Provider plugin at
`plugins/volcengine`:

- Plugin id: `clash.volcengine`
- Provider id: `volcengine`
- Executor export: `volcengine-execute`
- Upstream models: `doubao-seedance-2-0-260128` and
  `doubao-seedance-2-5-260628`
- Default endpoint: `https://ark.cn-beijing.volces.com/api/v3`; an account may
  override `baseUrl`
- The Host selects the account and scopes `context.store`; the plugin reads only
  that account's `apiKey` and `baseUrl`
- Seedance 2.5 all-purpose requests select `reference`, `edit`, or `extend`
  through `omni_reference_task_type`
- Editing requires a reference video and sends `duration=-1` plus
  `ratio=adaptive`; continuation accepts video references only
- Output is always requested as MP4. MOV is intentionally not a Model Card
  control.

The local Model Cards retain the published input envelopes: images are at most
30 MiB and 300–6000 px with a 0.4–2.5 aspect ratio; video is MP4/MOV, at most
200 MiB, 24–60 fps, and 2–15 seconds for 2.0 or 2–30 seconds for 2.5; audio is
WAV/MP3, at most 15 MiB, with the same version-specific duration ranges. A
Base64-embedded request is capped at 64 MiB.

## fal.ai

Sources:

- <https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/api>
- <https://fal.ai/models/bytedance/seedance-2.0/image-to-video/api>

Reference-to-video input excerpt:

```text
duration: auto, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
Default: auto

aspect_ratio: auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
Default: auto
```

Image-to-video exposes the same enums. Its `auto` ratio means infer from the
input image.

At capture time, both pages also list 480p, 720p, 1080p, and 4k. This supersedes
the earlier assumption that fal.ai exposed only 480p and 720p for Seedance 2.0.

## Replicate

Source:

- <https://replicate.com/bytedance/seedance-2.0/api/schema>

Input schema excerpt:

```text
duration integer
Video duration in seconds. Set to -1 for intelligent duration (model picks the best length).
Default 5; Minimum -1; Maximum 15

aspect_ratio string
Video aspect ratio. Set to 'adaptive' to let the model choose the best ratio based on inputs.
Default "16:9"
```

## KIE

Source:

- <https://docs.kie.ai/market/bytedance/seedance-2.md>

OpenAPI excerpt:

```yaml
aspect_ratio:
  type: string
  enum: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", adaptive]
  default: "16:9"

duration:
  type: integer
  description: Video duration in 4-15 seconds.
  default: 5
```

KIE therefore has ratio auto semantics through `adaptive`, but its published
contract has no intelligent-duration sentinel.

## Dreamina CLI (`jimeng`)

Source: locally installed `dreamina` binary, commit `4946b9d`, built
2026-03-31. Commands used:

```bash
dreamina --version
dreamina multimodal2video --help
dreamina image2video --help
dreamina frames2video --help
dreamina text2video --help
```

Relevant `multimodal2video` excerpt:

```text
model_version: seedance2.0, seedance2.0fast
ratio: 1:1, 3:4, 16:9, 4:3, 9:16, 21:9
video_resolution: 720p
duration: 4-15s (default 5)
```

`text2video` exposes the same fixed ratio and duration ranges. `image2video`
and `frames2video` state that ratio is inferred from the input / first-frame
image and is not set on those commands; duration remains an integer 4–15.

## Pika API Club

Expected catalog source:

- `https://api.dev.pika.art/catalog/apis/bytedance%2Fseedance-2.0%2Freference-to-video?expand=inputs`
- `https://api.dev.pika.art/catalog/apis/bytedance%2Fseedance-2.0%2Fimage-to-video?expand=inputs`

Both requests timed out from the capture environment. Until a catalog response
or official document is captured, support for either auto value remains
unverified. The fact that Clash currently sends `auto` is not independent
evidence that the provider accepts it.
