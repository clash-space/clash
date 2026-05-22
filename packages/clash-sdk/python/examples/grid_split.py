"""
Grid Split — slice a reference image into NxN tiles.

A local custom action that demonstrates the multi-output protocol:
one task in, N outputs out. The pending action-badge child gets the
first tile; tiles 2..N spawn as sibling image nodes on the canvas
sharing the action-badge as their upstream lineage.

Run:
    pip install clash-sdk pillow
    CLASH_PROJECT_ID=<id> CLASH_API_KEY=<token> \\
        python examples/grid_split.py

Usage on the canvas:
    1. Generate (or upload) an image that's a NxN grid layout.
    2. Add a "Grid Split NxN" action-badge, wire the grid image as
       its reference (drag an edge in, or @-mention).
    3. Set `grid_size` parameter ("2x2" / "3x3" / "4x4").
    4. Run. Watch N=grid_size^2 sibling image nodes appear.
"""

from __future__ import annotations

import io
import os
import asyncio
from typing import Awaitable, Callable

from clash_sdk import action, ActionContext, ActionResult, AssetOutput, run

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit(
        "grid_split requires Pillow. Install with: pip install pillow"
    ) from e


@action(
    id="grid-split",
    name="Grid Split",
    description="Slice the reference image into NxN tiles. Each tile becomes its own image node on the canvas.",
    output_type="image",
    prompt_modalities=["text", "image"],
    parameters=[
        {
            "id": "grid_size",
            "label": "Grid size",
            "type": "select",
            "defaultValue": "2x2",
            "options": [
                {"label": "2 x 2 (4 tiles)", "value": "2x2"},
                {"label": "3 x 3 (9 tiles)", "value": "3x3"},
                {"label": "4 x 4 (16 tiles)", "value": "4x4"},
            ],
        },
    ],
)
async def grid_split(ctx: ActionContext) -> ActionResult:
    if not ctx.reference_image_r2_keys:
        raise ValueError(
            "grid-split needs a reference image. Wire one upstream by "
            "dragging an edge from an image node, or @-mention it in the prompt."
        )
    if ctx.fetch_asset is None:
        # Shouldn't happen — ClashAgent injects this at dispatch time.
        # Bail loudly so we don't silently use a stale signature.
        raise RuntimeError("ctx.fetch_asset not bound; SDK version mismatch?")

    grid = str(ctx.params.get("grid_size", "2x2"))
    rows, cols = _parse_grid(grid)

    img_bytes = await ctx.fetch_asset(ctx.reference_image_r2_keys[0])
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    width, height = img.size
    tile_w, tile_h = width // cols, height // rows

    outputs: list[AssetOutput] = []
    total = rows * cols
    for r in range(rows):
        for c in range(cols):
            left, top = c * tile_w, r * tile_h
            right = width if c == cols - 1 else (c + 1) * tile_w
            bottom = height if r == rows - 1 else (r + 1) * tile_h
            tile = img.crop((left, top, right, bottom))

            buf = io.BytesIO()
            tile.save(buf, format="PNG", optimize=True)
            outputs.append(
                AssetOutput(
                    type="image",
                    data=buf.getvalue(),
                    mime_type="image/png",
                    label=f"tile {r * cols + c + 1}/{total}",
                )
            )

    return ActionResult.many(
        outputs=outputs,
        description=f"Sliced {width}x{height} into {rows}x{cols} grid ({total} tiles).",
    )


def _parse_grid(spec: str) -> tuple[int, int]:
    """'2x2' -> (2, 2). Falls back to (2, 2) on garbage input rather
    than throwing — better UX than a hard failure on a malformed param."""
    parts = spec.lower().split("x")
    if len(parts) != 2:
        return (2, 2)
    try:
        r = max(1, int(parts[0]))
        c = max(1, int(parts[1]))
        return (r, c)
    except ValueError:
        return (2, 2)


if __name__ == "__main__":
    run(
        server_url=os.environ.get("CLASH_SERVER_URL", "ws://localhost:8789"),
        project_id=os.environ.get("CLASH_PROJECT_ID", ""),
        token=os.environ.get("CLASH_API_KEY", ""),
        actions=[grid_split],
    )
