# Historical: video preview experiments (superseded)

> **Status:** Historical only. Browser media fragments, component-built
> thumbnail URLs, Cloudflare Stream examples, and ad hoc R2 cover keys from the
> former document are not current Clash contracts.

Use the canonical Asset design in
[`apps/docs/guide/asset-system.md`](../apps/docs/guide/asset-system.md), under
“Previews, thumbnails, and Project covers”. Current Local GUI code consumes the
entry-authorized `ResolvedAsset.thumbnailUrl` backed by a Host-private Durable
first-frame representation and falls back to `ResolvedAsset.url` while the
representation is unavailable. GUI code must never sign, rewrite, or infer
authority from a storage key or Provider URL.

Generation and publication use the separate
[`Durable Run protocol`](../apps/docs/guide/durable-run-protocol.md). It does
not make any Cloud preview or Cloud execution path current.

The retired unauthenticated `/thumbnails/<storage-key>` route has been removed
from api-cf, the Web gateway, and the legacy Loro sync worker. Local uses only
Project/Global entry-scoped thumbnail routes. Any future Cloud preview
implementation must authorize an Asset entry first; Cloud representation
execution remains deferred design work.
