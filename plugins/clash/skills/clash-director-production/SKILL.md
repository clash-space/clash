---
name: clash-director-production
description: Direct stronger staged video scenes through dramatic beats, expressive blocking, motivated cameras, readable action, and critical visual review.
---

# Clash Director Production

Treat the Stage as a performance space. The goal is not to fill it with objects
and cameras; the goal is to make the dramatic change readable from the chosen
point of view.

## Find the dramatic beat

For each beat, identify what a subject wants, what changes, and what the viewer
should notice first. Decide who owns the moment and whether the audience should
feel close, distant, informed, or uncertain. A scene without a change is an
illustration; give it an action, reaction, discovery, reversal, or decision.

## Block for meaning

Use position, distance, height, orientation, and movement to express power and
relationship. Preserve a clear line of action, coherent screen direction, and
believable eyelines unless disorientation is intentional. Entrances, exits,
crosses, and changes in distance should alter the scene rather than merely add
activity.

At important poses, check silhouettes and negative space. Separate limbs from
the torso, keep faces readable, protect contact points, and avoid accidental
tangencies. Stage the subject against a background with enough value and color
contrast to survive a small frame.

## Design motivated coverage

Every camera needs a reason. Establish geography only as much as the viewer
needs, then use changes in size, angle, height, and lens character to reveal
new information or intensify emotion. Favor a concise set of complementary
shots over many redundant angles.

Maintain orientation across cuts. Match action, gaze, and subject position when
continuity supports clarity; break them deliberately when the story calls for
impact or instability. Let reaction shots earn their duration. A camera move
should follow attention, reveal space, change power, or build anticipation—not
drift because motion is available.

## Shape motion and timing

Build actions around anticipation, decisive action, reaction, and settle.
Allow readable holds before and after important changes. Use arcs, weight,
momentum, overlap, and follow-through so bodies and props do not feel like
independent transforms. Reserve the strongest movement for the dramatic peak.

## Review like a director

- Read the scene as still frames at its beginning, turning point, and ending.
- Watch the action without audio for blocking, silhouette, eyeline, and camera
  motivation.
- Check every shot for a distinct narrative purpose and remove weak coverage.
- Compare the first and last image: their difference should express the beat.
- Distinguish a structurally editable Stage from sampled visual evidence and a
  genuinely rendered shot.

Revise the biggest storytelling ambiguity first. Technical completeness cannot
rescue unclear staging.

## Operate through Clash

Let the base `clash` skill own daemon discovery, workspace initialization,
transport navigation, and guarded writes. When a runner provides a ready
receipt, use its bound project and do not run init or start a daemon. In a
normal unbound repository, follow the base skill's initialization flow. Then
use `clash director --help` to reveal commands progressively and prefer focused
`create`, `object`, `camera`, `scene`, `keyframe`, and `action` operations. Use
`pull` and `apply` when full-state editing is more suitable.

CLI and MCP are peer interfaces with the same capabilities over the same
`local-api` product state. In an MCP session, start with the root `clash` tool,
select the Director menu, then list or read the target Stage before choosing
the most specific operation. Ask for the
authoritative schema only when full-state authoring requires it. Follow each
tool's description and returned next-step guidance rather than memorizing its
full schema here.

Before claiming a rendered result, capture at least the beginning, turning
point, and ending through `clash director capture` or
the Director menu's capture operation. Require the product renderer identity,
unchanged source/readback revision, exact times, active cameras, PNG hashes,
and a durable receipt. Inspect the returned PNGs; never substitute UI
screenshots or a different renderer for Director evidence.
