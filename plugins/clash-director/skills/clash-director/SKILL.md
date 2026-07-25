---
name: clash-director
description: Open, inspect, create, block, animate, and edit Clash Project Director Stages through the bundled GUI and typed MCP tools.
---

# Clash Director

Use `clash_director_*` tools for Director Stage work. Always pass the current
task workspace absolute `cwd`; it must resolve the real `.clash/project.toml`.

1. Read with `clash_director_open`, `list`, or `get` before describing state.
2. Use object, camera, scene, and keyframe tools for bounded mutations.
3. Use `save` for GUI drafts; it reads, writes the canonical
   `director-stages/<id>.director-stage.json` projection, validates, then
   applies through the CLI's implicit read proof.
4. Attach/detach only when ownership should change. Canvas nodes are lightweight
   actions; the Project Director Stage remains the source of truth.

Panoramas are ordinary Project image assets, not 3D models. Use a 360-degree
equirectangular image at an exact 2:1 ratio (WebP, PNG, or JPEG; 2048x1024 or
4096x2048), then bind its real asset ID with `clash_director_scene_update`.
For AI panorama work, use Clash's normal Canvas image-generation path so the
prompt, model, references, output asset, and Stage lineage remain observable.
The Director GUI requests the model's closest native 21:9 output and normalizes
the complete image to a 2:1 WebP without cropping the left/right seam. A normal
scene image may be selected as the reference for one-click 360 conversion.

On a stale-read failure, re-read and preserve the draft. Do not bypass CAS or
write full Stage state into Canvas nodes.
