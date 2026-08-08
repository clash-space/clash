---
name: composition-runtime-router
description: Route agent-authored React motion through Clash's supported composition delivery path. Use when deciding how a TSX animation should enter Canvas, stay live in Timeline, preview, and produce final media; authored composition code uses Remotion only.
---

# Remotion Composition Delivery

For agent-authored composition code, the route has three linked product states:

```text
editable Remotion TSX
  -> Canvas remotion-component node
  -> Timeline composition with sourceNodeId
  -> Timeline render receipt and playable Asset
```

Keep one default-exported TSX module in the Canvas node. The node's fixed ID is
the source identity: update its content in place after a fresh read so existing
Timeline items see the new implementation, just as a text node's readers see
its latest content.

The Timeline item uses `runtime: remotion`, `compositionKind: custom`, and the
Canvas ID as `sourceNodeId`. Preserve the full Timeline when editing it. Do not
copy component source into Timeline state, pin a private source snapshot, or
pre-render the component into an intermediate clip.

Use Canvas Player for iteration and Timeline preview for editorial context.
Only a completed `clash timeline render` or `clash_timeline_render` result with
a playable Asset proves final delivery. If the intended runtime is unavailable,
stop with a visible blocked result instead of inventing a substitute path.

Use the base Clash skill or live CLI/MCP descriptions for complete syntax. The
essential peer operations are Canvas add/get/update for `type: remotion`, then
Timeline get/save/validate/render with read-before-write and CAS revision
handling.
