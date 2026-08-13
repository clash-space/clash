# Historical: video preview experiments (superseded)

> **Status:** Historical only. Browser media fragments, component-built
> thumbnail URLs, Cloudflare Stream examples, and ad hoc R2 cover keys from the
> former document are not current Clash contracts.

Use the canonical Asset design in
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md), under
“Previews, thumbnails, and Project covers”. Current Local GUI code consumes the
entry-authorized `ResolvedAsset.url`, decodes poster frames in frontend
presentation code, and keeps them in disposable device caches. An
already-supplied legacy/remote `thumbnailUrl` is a read-only compatibility
input, not evidence of a backend poster protocol. GUI code must never sign,
rewrite, or infer authority from a storage key or Provider URL.

Generation and publication use the separate
[`Durable Run protocol`](../apps/docs/guide/durable-run-protocol.md). It does
not make any Cloud preview or Cloud execution path current.

The retired unauthenticated `/thumbnails/<storage-key>` route has been removed
from api-cf, the Web gateway, and the legacy Loro sync worker. Any future Cloud
preview implementation must authorize an Asset entry first. Backend
representations and Cloud execution remain deferred design work.
