# Historical: legacy video-thumbnail pipeline (superseded)

> **Status:** Historical only. This is not an implementation or migration
> guide. The Python thumbnail task, Loro-node `coverUrl` callback, and public
> storage-key thumbnail route described by the former version of this document
> have been superseded.

The current contract is defined in
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md), under
“Previews, thumbnails, and Project covers”. In particular:

- consumers receive original media through `ResolvedAsset.url`;
- Current Local CAS-publishes a first-frame WebP representation per immutable
  video Resource and versioned recipe through the shared Durable Run journal;
- `ResolvedAsset.thumbnailUrl` is an entry-authorized projection of that
  representation; frontend decoding remains a fallback while it is absent;
- `/thumbnails/<storage-key>` is removed. A storage key is neither an Asset
  identity nor authorization, and missing posters never fall back to serving
  the original video through that path.

Provider execution, representation retry/recovery, and output publication are
defined by the
[`Durable Run protocol`](../apps/docs/guide/durable-run-protocol.md); the legacy
Python thumbnail task in this snapshot is not part of that protocol.

Cloud OSS representation staging, collaboration synchronization, and physical
reclamation remain deferred. Do not revive the retired raw-storage-key endpoint
or copy its examples into a new service.
