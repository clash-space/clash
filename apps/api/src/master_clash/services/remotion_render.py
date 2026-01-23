"""
Remotion Video Rendering Service

Handles server-side video rendering using Remotion CLI.
The video is rendered from a Timeline DSL that contains tracks, items, and composition settings.

Architecture:
1. Bundle is pre-built (local dev) or fetched from R2 (production)
2. Timeline DSL is passed as --props to Remotion CLI
3. Rendered video is uploaded to R2
"""

import asyncio
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from master_clash.config import get_settings
from master_clash.json_utils import dumps as json_dumps
from master_clash.services import r2
from master_clash.workflow.timeline_resolver import resolve_timeline_dsl

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class RenderResult:
    """Result of video rendering."""

    success: bool
    r2_key: str | None = None
    error: str | None = None


async def prepare_asset_urls(timeline_dsl: dict[str, Any], frontend_url: str) -> dict[str, Any]:
    """
    Convert asset URLs in DSL to full HTTP URLs that Remotion CLI can access.

    Handles:
    - /api/assets/view/projects/... -> http://localhost:3000/api/assets/view/projects/...
    - projects/... -> http://localhost:3000/api/assets/view/projects/...

    Args:
        timeline_dsl: Original timeline DSL with asset URLs
        frontend_url: Frontend base URL (e.g., http://localhost:3000)

    Returns:
        Processed timeline DSL with full HTTP URLs
    """
    # Deep copy the DSL to avoid modifying the original
    processed_dsl = json.loads(json.dumps(timeline_dsl))

    def to_full_url(src: str) -> str:
        """Convert asset path to full HTTP URL."""
        if not src or not isinstance(src, str):
            return src

        # Already a full URL
        if src.startswith("http://") or src.startswith("https://"):
            return src

        # Skip data URLs
        if src.startswith("data:"):
            return src

        # Frontend proxy URL or R2 key - convert to full URL
        if src.startswith("/"):
            # Already a path, just add frontend base
            return f"{frontend_url}{src}"
        else:
            # R2 key like "projects/...", convert to frontend proxy URL
            return f"{frontend_url}/api/assets/view/{src}"

    # Process all tracks and items
    for track in processed_dsl.get("tracks", []):
        for item in track.get("items", []):
            if "src" in item and isinstance(item["src"], str):
                original_src = item["src"]
                item["src"] = to_full_url(original_src)
                logger.info(f"[Remotion] Asset URL: {original_src} -> {item['src']}")

    return processed_dsl


def get_entry_point() -> Path:
    """
    Get the path to the Remotion entry point.

    - Local development: packages/remotion-components/src/Root.tsx
    - Production: Use bundled version (TODO)

    Returns:
        Path to the entry point file
    """
    # Check if local source exists (for development)
    # File is at: apps/api/src/master_clash/services/remotion_render.py
    # Go up 6 levels to get to project root
    project_root = Path(__file__).parent.parent.parent.parent.parent.parent  # Go up to project root
    local_entry = project_root / "packages" / "remotion-components" / "src" / "Root.tsx"

    if local_entry.exists():
        logger.info(f"[Remotion] Using local entry: {local_entry}")
        return local_entry

    # Production: Use bundled version (TODO)
    bundle_dir = project_root / "packages" / "remotion-components" / "build"
    bundle_entry = bundle_dir / "index.html"  # Serve the bundled version

    if bundle_entry.exists():
        logger.info(f"[Remotion] Using bundled entry: {bundle_dir}")
        # For bundled version, we need to serve it as a URL
        # This is more complex, returning the directory for now
        return bundle_dir

    raise FileNotFoundError(f"Remotion entry not found. Looking for {local_entry}")


async def render_video_with_remotion(
    timeline_dsl: dict[str, Any],
    project_id: str,
    task_id: str,
    loro_client=None,
) -> RenderResult:
    """
    Render video using Remotion CLI.

    Args:
        timeline_dsl: Timeline DSL containing tracks, composition settings, etc.
        project_id: Project ID for R2 storage
        task_id: Task ID for naming the output file
        loro_client: Loro client to fetch asset node data for resolution

    Returns:
        RenderResult with success status and R2 key or error
    """
    try:
        # Get entry point (source file for dev, or bundled for production)
        entry_point = get_entry_point()

        # Get frontend URL for asset proxy
        settings = get_settings()
        frontend_url = settings.frontend_url

        # STEP 1: Resolve assetId references to complete src/type data
        # This transforms the reference-only timeline to a complete timeline for rendering
        logger.info(f"[Remotion] Resolving timeline references for task {task_id}")
        resolved_dsl = resolve_timeline_dsl(timeline_dsl, loro_client)
        logger.info("[Remotion] Timeline resolved successfully")

        # STEP 2: Prepare asset URLs (convert R2 keys to full HTTP URLs)
        processed_dsl = await prepare_asset_urls(resolved_dsl, frontend_url)

        # Prepare output path (temp file)
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            output_file = temp_path / f"{task_id}.mp4"

            # Prepare props JSON with processed DSL
            # Ensure durationInFrames is an integer
            duration_frames = processed_dsl.get("durationInFrames", 300)
            try:
                duration_frames = int(duration_frames)
            except (ValueError, TypeError):
                logger.warning(
                    f"[Remotion] Invalid durationInFrames: {duration_frames}, defaulting to 300"
                )
                duration_frames = 300

            props_dict = {
                "tracks": processed_dsl.get("tracks", []),
                "compositionWidth": processed_dsl.get("compositionWidth", 1920),
                "compositionHeight": processed_dsl.get("compositionHeight", 1080),
                "fps": processed_dsl.get("fps", 30),
                "durationInFrames": duration_frames,
            }
            props_json = json_dumps(props_dict)

            # Log the timeline DSL for debugging
            logger.info(f"[Remotion] Timeline DSL for task {task_id}:")
            logger.info(f"[Remotion]   Tracks: {len(processed_dsl.get('tracks', []))} track(s)")
            logger.info(
                f"[Remotion]   Duration: {duration_frames} frames ({duration_frames / 30:.2f}s)"
            )
            logger.info(
                f"[Remotion]   Composition: {props_dict.get('compositionWidth')}x{props_dict.get('compositionHeight')}"
            )

            for i, track in enumerate(processed_dsl.get("tracks", [])):
                logger.info(
                    f"[Remotion]     Track {i}: {track.get('id', 'unknown')} - {len(track.get('items', []))} item(s)"
                )
                for j, item in enumerate(track.get("items", [])):
                    logger.info(
                        f"[Remotion]       Item {j}: type={item.get('type')}, from={item.get('from')}, duration={item.get('durationInFrames')}, src={str(item.get('src'))[:50]}"
                    )

            logger.info(f"[Remotion]   Props JSON (first 500 chars): {props_json}...")

            # Build Remotion CLI command
            # Using the entry point directly (source file or bundled directory)
            cmd = [
                "npx",
                "remotion",
                "render",
                str(entry_point),
                "VideoComposition",
                "--props",
                props_json,
                "--output",
                str(output_file),
                "--overwrite",
                "--log",
                "info",
                "--timeout-in-milliseconds",
                "120000",  # 120 seconds (2 minutes) for image loading timeout
            ]

            logger.info(f"[Remotion] Running: {' '.join(cmd)}")

            # Run Remotion CLI (blocking)
            # Note: asyncio.subprocess could be used for async, but Remotion CLI
            # handles its own multiprocessing, so subprocess.run is fine
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=1800,  # 30 minutes timeout
                ),
            )

            # Log output for debugging
            if result.stdout:
                logger.info(f"[Remotion] stdout: {result.stdout[:1000]}")
            if result.stderr:
                logger.error(f"[Remotion] stderr: {result.stderr[:1000]}")

            if result.returncode != 0:
                raise RuntimeError(
                    f"Remotion CLI failed with code {result.returncode}: {result.stderr}"
                )

            # Check if output file exists
            if not output_file.exists():
                return RenderResult(
                    success=False, error="Render completed but output file not found"
                )

            # Upload to R2
            video_data = output_file.read_bytes()
            r2_key = f"projects/{project_id}/renders/{task_id}.mp4"
            await r2.put_object(r2_key, video_data, "video/mp4")

            logger.info(f"[Remotion] ✅ Rendered video uploaded to R2: {r2_key}")
            logger.info(f"[Remotion] Video size: {len(video_data)} bytes")

            return RenderResult(success=True, r2_key=r2_key)

    except subprocess.TimeoutExpired:
        logger.error("[Remotion] ❌ Render timed out after 30 minutes")
        return RenderResult(success=False, error="Render timed out")

    except FileNotFoundError as e:
        logger.error(f"[Remotion] ❌ Bundle not found: {e}")
        return RenderResult(success=False, error=str(e))

    except Exception as e:
        logger.error(f"[Remotion] ❌ Render failed: {e}", exc_info=True)
        return RenderResult(success=False, error=str(e))
