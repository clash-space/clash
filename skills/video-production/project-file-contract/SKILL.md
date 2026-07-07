---
name: project-file-contract
description: Use when designing Clash project-local files, editable/protected paths, analysis files, plans, projections, reports, and agent-safe ownership boundaries.
---

# Project File Contract

Use this skill to decide which files agents may edit directly.

Editable:

- `brief/`
- `analysis/`
- `plans/`
- `storyboards/`
- `projections/` through pull/apply locks
- `reviews/`

Protected:

- `snapshot.bin`
- SQLite/product DB
- credentials
- runtime/tool caches
- approved media blobs unless copy-on-write creates a new version

Every file that affects canvas/timeline must either be a projection with CAS or
an input to an explicit product command.
