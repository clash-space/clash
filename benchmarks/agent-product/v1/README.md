# Agent Product Benchmark v1

Version 1 is split deliberately between runnable product paths and explicit
contract gaps.

Runnable paths cover Project Asset byte identity and lifecycle, Director Stage
capture, Timeline rendering, editable Remotion components, and a medium
Director + Canvas Remotion + Timeline functional regression. Every runnable
case requires both a successful product-operation trace and trusted Host
readback.

The mixed regression is deliberately scoreable without a content-quality
reviewer. It keeps the same medium functional floor used by the real mixed
smoke: four Stage objects, two cameras, three ordered sequence shots, one
changing animation track, exact Remotion TSX persisted through Canvas, at least
three Timeline tracks and five items over 270 frames, exact capture-receipt and
Asset-reference lineage across the final Stage revision and Timeline, and one completed
1080x1080 product render. Its pass score is 100; creative effect remains a
separate Evaluation in the creative-artifacts suite.

Blocked paths describe the intended native Generator and Document workflows.
They remain blocked until Clash exposes the missing Agent-facing CLI or MCP
surface and independent readback. In particular, the existence of an internal
HTTP route is not enough to call an Agent workflow available.

`fixtures/asset-svg-v1` contains a small deterministic SVG used to verify exact
Project Asset bytes without downloading or generating media.

| Lane    | Category             | Case                                   |
| ------- | -------------------- | -------------------------------------- |
| Ready   | Asset                | `asset-image-exact-import-v1`          |
| Ready   | Asset lifecycle      | `asset-trash-restore-v1`               |
| Ready   | Director             | `director-three-beat-v1`               |
| Ready   | Timeline             | `timeline-multitrack-render-v1`        |
| Ready   | Remotion             | `remotion-character-render-v1`         |
| Ready   | Mixed                | `mixed-director-remotion-timeline-v1`  |
| Blocked | Generator            | `generator-multi-action-v1`            |
| Blocked | Generator COW/replay | `generator-cow-replay-v1`              |
| Blocked | Document             | `document-version-attachment-v1`       |
| Blocked | ASR → Document       | `asr-generator-transcript-document-v1` |
| Blocked | Stage Generator      | `stage-generator-multi-action-v1`      |
| Blocked | Timeline Generator   | `timeline-generator-render-v1`         |
