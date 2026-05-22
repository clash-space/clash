/**
 * Actions registry / package API.
 *
 * Until we have a real marketplace, this endpoint serves a hardcoded
 * curated list of example actions — the same files that live under
 * `packages/clash-sdk/python/examples/`. The CLI `action install <id>`
 * subcommand pulls a package from here and writes it to
 * `~/.clash/actions/<id>/`, which the bridge then auto-loads via fs.watch.
 *
 * Endpoints:
 *   GET /api/v1/actions                  — list available actions (manifest only)
 *   GET /api/v1/actions/:id/package      — fetch full package (manifest + files)
 *
 * Auth: any authenticated user. Anyone with a valid clsh_ token or
 * better-auth session may pull a package — these aren't paid assets.
 *
 * The registry is intentionally hardcoded as a TS object below. When a
 * real marketplace lands, swap this loader for a D1-backed lookup; the
 * response shape is what the CLI depends on, not the storage.
 */

import { Hono } from "hono";
import type { Env } from "../../config";

// ─── Curated registry ─────────────────────────────────────────────
//
// One entry per action that ships in `packages/clash-sdk/python/examples/`.
// `files[path]` is the raw UTF-8 contents of each file in the package;
// the route base64-encodes them on the way out so the CLI doesn't have
// to deal with embedded JSON escapes.
//
// To add a new action: drop the manifest + handler source here and the
// CLI's `install` and `list --remote` subcommands pick it up for free.

interface PackageFile {
  /** UTF-8 source of the file. */
  contents: string;
}

interface RegistryEntry {
  manifest: Record<string, unknown>;
  files: Record<string, PackageFile>;
}

const REGISTRY: Record<string, RegistryEntry> = {
  "grid-split": {
    manifest: {
      id: "grid-split",
      name: "Grid Split",
      description:
        "Slice the reference image into NxN tiles. Each tile becomes its own image node on the canvas.",
      outputType: "image",
      promptModalities: ["text", "image"],
      parameters: [
        {
          id: "grid_size",
          label: "Grid size",
          type: "select",
          defaultValue: "2x2",
          options: [
            { label: "2 x 2 (4 tiles)", value: "2x2" },
            { label: "3 x 3 (9 tiles)", value: "3x3" },
            { label: "4 x 4 (16 tiles)", value: "4x4" },
          ],
        },
      ],
      runtime: "local",
      entrypoint: "handler.py",
      version: "0.1.0",
      attachedProjects: ["*"],
    },
    files: {
      "handler.py": {
        contents: GRID_SPLIT_HANDLER_PY(),
      },
    },
  },
  "echo": {
    manifest: {
      id: "echo",
      name: "Echo",
      description: "Returns the prompt text back as a text node.",
      outputType: "text",
      promptModalities: ["text"],
      parameters: [],
      runtime: "local",
      entrypoint: "handler.py",
      version: "0.1.0",
      attachedProjects: ["*"],
    },
    files: {
      "handler.py": {
        contents: ECHO_HANDLER_PY(),
      },
    },
  },
  "forced-fail": {
    manifest: {
      id: "forced-fail",
      name: "Forced Fail",
      description:
        "Always raises. Used for end-to-end testing of the custom-action failure path.",
      outputType: "image",
      promptModalities: ["text"],
      parameters: [],
      runtime: "local",
      entrypoint: "handler.py",
      version: "0.1.0",
      attachedProjects: ["*"],
    },
    files: {
      "handler.py": {
        contents: FORCED_FAIL_HANDLER_PY(),
      },
    },
  },
};

// ─── Routes ───────────────────────────────────────────────────────

export const actionsRoutes = new Hono<{ Bindings: Env }>();

actionsRoutes.get("/", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const actions = Object.values(REGISTRY).map((e) => ({
    id: e.manifest.id,
    name: e.manifest.name,
    description: e.manifest.description,
    version: e.manifest.version,
    runtime: e.manifest.runtime,
    outputType: e.manifest.outputType,
  }));
  return c.json({ actions });
});

actionsRoutes.get("/:id/package", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const entry = REGISTRY[id];
  if (!entry) return c.json({ error: `Unknown action: ${id}` }, 404);

  // Encode each file as base64 so the CLI can write arbitrary bytes
  // without worrying about UTF-8 round-tripping when handlers ship
  // their own data assets later (icons, models, ...).
  const files: Record<string, string> = {};
  for (const [path, file] of Object.entries(entry.files)) {
    files[path] = base64Encode(file.contents);
  }

  return c.json({
    id,
    manifest: entry.manifest,
    files,
  });
});

// ─── helpers ──────────────────────────────────────────────────────

function base64Encode(s: string): string {
  // Workers runtime has btoa, but it operates on Latin-1 strings — we
  // need to UTF-8 encode first to be safe for any non-ASCII handler
  // (e.g. emoji in docstrings).
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─── Bundled handler sources ──────────────────────────────────────
//
// These are inlined verbatim from packages/clash-sdk/python/examples/.
// We bundle them as functions returning string literals so esbuild /
// wrangler can tree-shake without dragging in any sibling source.
// Keep these in sync with the python/examples/ files when they change.

function GRID_SPLIT_HANDLER_PY(): string {
  return `"""
Grid Split — slice a reference image into NxN tiles.

A local custom action that demonstrates the multi-output protocol:
one task in, N outputs out. The pending action-badge child gets the
first tile; tiles 2..N spawn as sibling image nodes on the canvas
sharing the action-badge as their upstream lineage.

Run:
    pip install clash-sdk pillow
    CLASH_PROJECT_ID=<id> CLASH_API_KEY=<token> \\\\
        python examples/grid_split.py

Usage on the canvas:
    1. Generate (or upload) an image that's a NxN grid layout.
    2. Add a "Grid Split NxN" action-badge, wire the grid image as
       its reference (drag an edge in, or @-mention).
    3. Set \`grid_size\` parameter ("2x2" / "3x3" / "4x4").
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
`;
}

function ECHO_HANDLER_PY(): string {
  return `"""
Example: Simple echo action that returns the prompt as text.

Usage:
    python examples/echo_action.py

Environment variables:
    CLASH_SERVER_URL  - WebSocket URL (default: ws://localhost:8789)
    CLASH_PROJECT_ID  - Project ID to connect to
    CLASH_API_KEY     - Authentication token
"""

import os

from clash_sdk import action, ActionContext, ActionResult, run


@action(
    id="echo",
    name="Echo",
    description="Returns the prompt text back as a text node",
    output_type="text",
)
async def echo(ctx: ActionContext) -> ActionResult:
    return ActionResult.text(
        content=f"Echo: {ctx.prompt}",
        description="Echoed prompt text",
    )


if __name__ == "__main__":
    run(
        server_url=os.environ.get("CLASH_SERVER_URL", "ws://localhost:8789"),
        project_id=os.environ.get("CLASH_PROJECT_ID", ""),
        token=os.environ.get("CLASH_API_KEY", ""),
        actions=[echo],
    )
`;
}

function FORCED_FAIL_HANDLER_PY(): string {
  return `"""
Forced-fail action — always raises. Used to exercise the failure path
of the multi-output protocol end-to-end:

  agent raises → ActionResult never returned → SDK sends
    {type: "complete_custom_task", status: "failed", result: {error,
    assets: []}}
  → ProjectRoom marks primary node \`status: 'failed'\` with the error
    string, deletes the tasksMap entry, spawns NO sibling nodes.

Run alongside grid_split or alone:
  CLASH_PROJECT_ID=<id> CLASH_API_KEY=<token> python examples/forced_fail.py
"""

from __future__ import annotations

import os
import asyncio

from clash_sdk import action, ActionContext, ActionResult, run


@action(
    id="forced-fail",
    name="Forced Fail",
    description="Always raises. For testing the failure path of custom actions.",
    output_type="image",
    prompt_modalities=["text"],
)
async def forced_fail(ctx: ActionContext) -> ActionResult:
    raise RuntimeError("intentional failure for end-to-end testing")


if __name__ == "__main__":
    run(
        server_url=os.environ.get("CLASH_SERVER_URL", "ws://localhost:8789"),
        project_id=os.environ.get("CLASH_PROJECT_ID", ""),
        token=os.environ.get("CLASH_API_KEY", ""),
        actions=[forced_fail],
    )
`;
}
