"""
/**
 * @file mg_animation.py
 * @description Generate motion-graphics React components with Gemini and render via Remotion.
 * @module master_clash.services.mg_animation
 *
 * @responsibility
 * - Create Remotion-ready React component code from a text brief.
 * - Persist component source and render output video with Remotion CLI.
 *
 * @exports
 * - render_mg_animation: Generate component code, render, and upload the video.
 */
"""

from __future__ import annotations

import asyncio
import logging
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from master_clash.config import get_settings
from master_clash.services import r2

logger = logging.getLogger(__name__)


@dataclass
class MgRenderResult:
    success: bool
    r2_key: str | None = None
    code_r2_key: str | None = None
    component_path: Path | None = None
    error: str | None = None


def _coerce_int(value: Any, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    try:
        num = int(value)
    except Exception:  # noqa: BLE001
        num = default

    if min_value is not None and num < min_value:
        num = min_value
    if max_value is not None and num > max_value:
        num = max_value
    return num


def _extract_tsx(text: str) -> str:
    match = re.search(r"```(?:tsx|typescript|ts)?\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def _ensure_default_export(code: str) -> str:
    if "export default" in code:
        return code
    match = re.search(r"export const (\w+)", code)
    if match:
        return f"{code.rstrip()}\n\nexport default {match.group(1)};\n"
    return code


def _get_project_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _resolve_output_dir(project_root: Path, configured: Path) -> Path:
    if configured.is_absolute():
        return configured
    return (project_root / configured).resolve()


def _build_component_prompt(
    description: str,
    *,
    duration_seconds: int,
    width: int,
    height: int,
    fps: int,
) -> str:
    duration_frames = duration_seconds * fps
    return (
        "You are a senior motion-graphics developer using Remotion.\n"
        "Generate a single React component in TSX that renders an animated motion-graphics scene.\n"
        "Requirements:\n"
        f"- Canvas size: {width}x{height}\n"
        f"- FPS: {fps}\n"
        f"- Duration: {duration_seconds}s ({duration_frames} frames)\n"
        "- Use only Remotion primitives (AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig).\n"
        "- No external assets, no network requests, no font imports.\n"
        "- Keep everything self-contained and deterministic.\n"
        "- Use simple shapes, gradients, and text to convey the idea.\n"
        "- Export a component named MgAnimation and also export default.\n"
        "- Output ONLY the TSX code, no markdown.\n"
        "\n"
        f"Brief: {description}\n"
    )


async def _generate_component_code(description: str, duration_seconds: int, width: int, height: int, fps: int) -> str:
    settings = get_settings()
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        base_url=settings.google_ai_studio_base_url,
        transport="rest",
    )
    prompt = _build_component_prompt(
        description,
        duration_seconds=duration_seconds,
        width=width,
        height=height,
        fps=fps,
    )
    message = HumanMessage(content=prompt)
    response = await asyncio.to_thread(llm.invoke, [message])
    code = _extract_tsx(response.content or "")
    code = _ensure_default_export(code)
    return code


def _build_entry_file(component_filename: str, width: int, height: int, fps: int, duration_frames: int) -> str:
    return (
        "import React from 'react';\n"
        "import { Composition, registerRoot } from 'remotion';\n"
        f"import MgAnimation from './{component_filename}';\n\n"
        "export const RemotionRoot: React.FC = () => (\n"
        "  <Composition\n"
        "    id=\"MGAnimation\"\n"
        "    component={MgAnimation}\n"
        f"    width={width}\n"
        f"    height={height}\n"
        f"    fps={fps}\n"
        f"    durationInFrames={duration_frames}\n"
        "  />\n"
        ");\n\n"
        "registerRoot(RemotionRoot);\n"
    )


async def render_mg_animation(
    *,
    description: str,
    project_id: str,
    task_id: str,
    params: dict[str, Any] | None = None,
) -> MgRenderResult:
    params = params or {}
    width = _coerce_int(params.get("width"), 1920, min_value=320, max_value=3840)
    height = _coerce_int(params.get("height"), 1080, min_value=320, max_value=3840)
    fps = _coerce_int(params.get("fps"), 30, min_value=12, max_value=60)
    duration_seconds = _coerce_int(params.get("duration"), 5, min_value=1, max_value=60)
    duration_frames = duration_seconds * fps

    project_root = _get_project_root()
    output_root = _resolve_output_dir(project_root, get_settings().output_dir)
    component_dir = output_root / "mg_components" / task_id
    component_dir.mkdir(parents=True, exist_ok=True)

    component_filename = "MgAnimation.tsx"
    entry_filename = "Root.tsx"
    component_path = component_dir / component_filename
    entry_path = component_dir / entry_filename

    try:
        logger.info("[MG] Generating component code for task %s", task_id)
        component_code = await _generate_component_code(
            description,
            duration_seconds,
            width,
            height,
            fps,
        )
        if not component_code.strip():
            return MgRenderResult(success=False, error="Gemini returned empty component code")

        component_path.write_text(component_code, encoding="utf-8")
        entry_path.write_text(
            _build_entry_file(component_filename, width, height, fps, duration_frames),
            encoding="utf-8",
        )

        code_r2_key = f"projects/{project_id}/generated/mg_{task_id}.tsx"
        await r2.put_object(code_r2_key, component_code.encode("utf-8"), "text/plain")

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / f"{task_id}.mp4"
            cmd = [
                "npx",
                "remotion",
                "render",
                str(entry_path),
                "MGAnimation",
                "--output",
                str(output_path),
                "--overwrite",
                "--log",
                "info",
                "--timeout-in-milliseconds",
                "120000",
            ]

            logger.info("[MG] Running Remotion render for task %s", task_id)
            result = subprocess.run(
                cmd,
                cwd=str(project_root),
                capture_output=True,
                text=True,
                check=False,
            )

            if result.returncode != 0:
                logger.error("[MG] Remotion render failed: %s", result.stderr[:1000])
                return MgRenderResult(
                    success=False,
                    error=f"Remotion render failed: {result.stderr.strip()}",
                )

            if not output_path.exists():
                return MgRenderResult(success=False, error="Rendered output file not found")

            video_bytes = output_path.read_bytes()
            video_r2_key = f"projects/{project_id}/generated/mg_{task_id}.mp4"
            await r2.put_object(video_r2_key, video_bytes, "video/mp4")

        return MgRenderResult(
            success=True,
            r2_key=video_r2_key,
            code_r2_key=code_r2_key,
            component_path=component_path,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("[MG] Render failed: %s", exc, exc_info=True)
        return MgRenderResult(success=False, error=str(exc))
