"""Unit test for the grid_split example action.

Runs the handler in-process — no Loro doc, no WebSocket, no R2. The
ctx.fetch_asset shim returns the bytes of a synthetic test image so
we can assert the handler slices it correctly without needing the
real /assets/sign endpoint.
"""

from __future__ import annotations

import io
import sys
import asyncio
from pathlib import Path

import pytest
from PIL import Image

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))
sys.path.insert(0, str(SDK_DIR / "examples"))

from clash_sdk import ActionContext  # noqa: E402
from grid_split import grid_split, _parse_grid  # noqa: E402


def _make_test_image(width: int = 400, height: int = 400) -> bytes:
    """A simple RGB image with each quadrant a different solid color so
    we can verify slicing puts the right pixels in the right tile."""
    img = Image.new("RGB", (width, height), color="white")
    # Top-left red, top-right green, bottom-left blue, bottom-right yellow.
    half_w, half_h = width // 2, height // 2
    Image.new("RGB", (half_w, half_h), "red").paste(img, (0, 0))
    # Pillow's paste here is awkward — easier path is per-pixel via crop+paste:
    img.paste(Image.new("RGB", (half_w, half_h), "red"), (0, 0))
    img.paste(Image.new("RGB", (half_w, half_h), "green"), (half_w, 0))
    img.paste(Image.new("RGB", (half_w, half_h), "blue"), (0, half_h))
    img.paste(Image.new("RGB", (half_w, half_h), "yellow"), (half_w, half_h))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_parse_grid_handles_garbage():
    assert _parse_grid("2x2") == (2, 2)
    assert _parse_grid("3X3") == (3, 3)
    assert _parse_grid("") == (2, 2)
    assert _parse_grid("notagrid") == (2, 2)
    assert _parse_grid("0x0") == (1, 1)  # clamped to 1+


def test_grid_split_produces_four_tiles():
    src_bytes = _make_test_image()

    async def _fetch(_key: str) -> bytes:
        return src_bytes

    ctx = ActionContext(
        task_id="t1",
        node_id="n1",
        project_id="p1",
        action_id="grid-split",
        prompt="",
        params={"grid_size": "2x2"},
        output_type="image",
        reference_image_r2_keys=["fake/key.png"],
        fetch_asset=_fetch,
    )

    result = asyncio.run(grid_split.handler(ctx))
    assert len(result.outputs) == 4
    for i, out in enumerate(result.outputs):
        assert out.type == "image"
        assert out.mime_type == "image/png"
        assert out.label == f"tile {i + 1}/4"
        assert isinstance(out.data, (bytes, bytearray)) and len(out.data) > 0

    # The top-left tile should be (mostly) red. Sample the center pixel.
    top_left = Image.open(io.BytesIO(result.outputs[0].data)).convert("RGB")
    center = (top_left.size[0] // 2, top_left.size[1] // 2)
    r, g, b = top_left.getpixel(center)
    assert r > 200 and g < 60 and b < 60, f"Expected red, got rgb=({r},{g},{b})"


def test_grid_split_3x3_produces_nine_tiles():
    src_bytes = _make_test_image(600, 600)

    async def _fetch(_key: str) -> bytes:
        return src_bytes

    ctx = ActionContext(
        task_id="t1",
        node_id="n1",
        project_id="p1",
        action_id="grid-split",
        prompt="",
        params={"grid_size": "3x3"},
        output_type="image",
        reference_image_r2_keys=["fake/key.png"],
        fetch_asset=_fetch,
    )

    result = asyncio.run(grid_split.handler(ctx))
    assert len(result.outputs) == 9


def test_grid_split_requires_reference():
    ctx = ActionContext(
        task_id="t1",
        node_id="n1",
        project_id="p1",
        action_id="grid-split",
        prompt="",
        params={"grid_size": "2x2"},
        output_type="image",
        reference_image_r2_keys=[],
    )
    with pytest.raises(ValueError, match="reference image"):
        asyncio.run(grid_split.handler(ctx))
