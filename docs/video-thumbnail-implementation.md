# Historical: legacy video-thumbnail pipeline (superseded)

> **Status:** Historical only. This is not an implementation or migration
> guide. The Python thumbnail task, Loro-node `coverUrl` callback, and public
> storage-key thumbnail route described by the former version of this document
> have been superseded.

The current contract is defined in
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md), under
“Previews, thumbnails, and Project covers”. In particular:

- consumers receive original media through `ResolvedAsset.url`;
- Current Local derives poster frames in frontend presentation code and keeps
  them in disposable device caches, just like waveform peaks and filmstrips;
- an already-supplied legacy/remote `ResolvedAsset.thumbnailUrl` may be read as
  a compatibility input, but it does not imply a Local backend poster protocol;
- `/thumbnails/<storage-key>` is removed. A storage key is neither an Asset
  identity nor authorization, and missing posters never fall back to serving
  the original video through that path.

Provider execution, retry, recovery, and output publication are separately
defined by the
[`Durable Run protocol`](../apps/docs/guide/durable-run-protocol.md); the legacy
thumbnail task in this snapshot is not part of that protocol.

Backend poster generation, including any future Cloud OSS staging,
collaboration synchronization, and physical reclamation, is deferred. Do not
revive the retired endpoint or copy its examples into a new service.
