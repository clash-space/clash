---
name: copy-on-write-lineage
description: Use when designing copy-on-write media edits, immutable references, derived asset lineage, rights inheritance, replacement policies, and force/replace audit behavior.
---

# Copy-on-Write Lineage

Use this skill when a media/text/timeline entity has downstream references.

Rules:

- Never overwrite referenced source media.
- Trim, caption burn, denoise, crop, or remix creates a derived asset.
- Derived assets record parent ids, operation, parameters, source hashes, and
  rights inheritance.
- To show a derived asset on the timeline, project it explicitly into an
  editable timeline view and apply through CAS; projections never mutate
  canvas/timeline state by themselves.
- Force replace must be explicit and auditable.
- Text nodes with downstream references follow the same rule as image/video.

Output a lineage plan before implementing destructive-looking edits.
