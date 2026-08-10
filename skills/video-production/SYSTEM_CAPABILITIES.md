# Video Production System Capabilities

Clash-native product capabilities available to skills. A skill owns workflow
instructions, artifact contracts, QA criteria, and license constraints. Clash
owns collaboration and management: asset registration, declared metadata,
provenance, timeline CAS apply, and canvas/timeline projections.

Anything not listed here is skill-owned: write it as declarative JSON in the
working tree and check it yourself.

## Available

- `media.metadata-registry`: declared asset metadata kinds. `media.transcript`
  and `media.description` ship built in; a workspace declares its own under
  `.clash/metadata-kinds/*.json` with a JSON Schema that pins `kind` and
  `schemaVersion`. An undeclared kind is refused everywhere.
- `media.analysis-store`: attached metadata is identity-on-the-asset, plus a
  content-addressed body blob (`$CLASH_HOME/local-api/metadata-blobs/`,
  immutable, deduplicated by sha256), plus a queryable SQLite row
  (`asset_metadata_index`, `GET /api/v1/local/asset-metadata`).
- `media.transcript`: `/api/v1/local/audio/transcriptions` returns a validated
  millisecond word-level `clash.asr.timed-transcript`. Attaching it records
  backend/model provenance, the media `sourceHash`, a word-grid `contentHash`
  that survives cosmetic restatement, and a summary. Timeline transcript
  projections prefer this canonical grid over editor caches.
- `media.metadata-cas`: every declared kind round-trips through
  `clash assets metadata set/get/list/apply` with an editable projection under
  `projections/metadata/`, stale-write rejection, and an append-only
  `metadataFills` provenance ledger. The fill envelope is synthesized
  internally; there is no action file to author.
- `render.remotion-composition`: Canvas `remotion-component` nodes hold editable
  default-exported Remotion TSX; Timeline `composition` items bind the Canvas
  identity through `sourceNodeId`; a completed Timeline render creates the
  playable product Asset and receipt.
- `timeline.cas-projection`: timeline/text pull-edit-apply with implicit CAS.
- `audio.local-asr-install`: `clash models local catalog/status/install` reads
  the same model cards as the GUI, resolves card ids to runtime ids, and
  installs Whisper/SenseVoice/Parakeet class models through the product path.

## Partial

- `media.asset-registry`: asset rows, refs, and blob storage exist; consistent
  path-ownership checks across every media workflow are still incomplete.
- `render.export-validation`: render receipts and playable final Assets exist;
  loudness, OCR/logo, and broader referenced-media validation remain missing.
