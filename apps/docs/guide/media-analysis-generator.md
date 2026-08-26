# Media analysis Generator

`clash.media-analysis` is a bundled, inert first-party executable plugin. It is
never run on import and media import never schedules analysis. Agents create a
Project Generator revision and submit its ordinary `analyze` Action through the
existing Generator CLI/MCP surface.

The Generator definition is the category authority. Every category declares its
own selectable output slot, source media kinds, prompt/version, and typed
Document kind. The Host derives Settings `categoryOptions` and Action validation
from that installed definition; it does not keep a second category list.
Verbatim transcripts are intentionally absent and remain owned by `clash.asr`.

Before admission, the Host freezes the active Project Asset id, immutable
Resource SHA-256, media kind, selected categories, Settings-selected model id,
the exact Provider implementation route resolved for that Card, Generator
revision id, Action Run id, and each declaration-owned prompt version. Each
selected category is a required `1..1` slot in the immutable Run contract.
Unselected slots are absent.

## Model routing

Settings are stored under `media_analysis` in `$CLASH_HOME/config.yaml` and are
available at `GET/PUT /api/v1/local/media-analysis`. Model candidates must be
text-output Cards with a configured executable route and the source modality.
The same resolver is used for options, PUT validation, and execution. Video runs
also require `video_enabled: true`.

Settings persist only the Card id; a Card keeps its full 1:N
`providerImplementations`. At Run submission the Host resolves one currently
enabled/configured/executable implementation and freezes it into the public
`modelSelection.route` (and the Run fingerprint). Execution pins to exactly that
implementation and fails rather than silently substituting another route, so
Settings validation, execution, and Document lineage cannot disagree.

The Hilo Provider plugin (`hrhrng.hub`) owns the private
`hilo-hub-media-analysis` Card and its `hub-analyse-media` implementation. The
Card is excluded from catalogs without a matching consumer context and appears
for the media-analysis Generator because its declarative consumer scope
matches. `clash.media-analysis` itself does not know Hilo. The implementation
is available only when its Provider account is enabled/configured and the exact
Provider executor binding is active. Calls use the verified cloud adapter shape:

```json
{ "media_data": "<base64>", "mime_type": "video/mp4", "question": "..." }
```

No model parameter is sent. Lineage records the Card id, actual selected
Provider/API route, and `provider-managed` underlying-model semantics. Other
compatible VLM Cards run through the same `ExternalAigcService.generateText`
route resolver, including native Google image/video/audio reference routes.

## Publication

The executor emits one typed JSON Document per selected category. Required
multi-slot results are staged privately and published as a single Project
mutation only after every required slot succeeds. Publication creates immutable
Document revisions, per-slot `OutputCommit`s, producer lineage, and attachments
to the exact source Project Asset. A failed required output leaves no completed
public analysis metadata. Exact replays reuse immutable output identity; a new
Action Run creates new revisions and leaves old revisions readable.
