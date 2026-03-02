"""Async client for Kling KIE aggregation API (https://docs.kie.ai/)."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from master_clash.config import get_settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.kie.ai/api/v1/jobs"
CREATE_TASK_URL = f"{BASE_URL}/createTask"
QUERY_TASK_URL = f"{BASE_URL}/recordInfo"


def _build_headers() -> dict[str, str]:
    api_key = get_settings().kie_api_key
    if not api_key:
        raise ValueError("KIE_API_KEY not configured")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


async def _post(payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(CREATE_TASK_URL, json=payload, headers=_build_headers())
    response.raise_for_status()

    result = response.json()
    if result.get("code") != 200:
        raise RuntimeError(result.get("msg", "KIE createTask failed"))
    return result


async def _get(params: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(QUERY_TASK_URL, params=params, headers=_build_headers())
    response.raise_for_status()

    result = response.json()
    if result.get("code") != 200:
        raise RuntimeError(result.get("msg", "KIE recordInfo failed"))
    return result


async def create_text_to_video_task(
    prompt: str,
    duration: str = "5",
    aspect_ratio: str = "16:9",
    negative_prompt: str = "blur, distort, low quality",
    cfg_scale: float = 0.5,
    resolution: str | None = None,
    model: str = "kling/v2-5-turbo-text-to-video-pro",
    callback_url: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "input": {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "negative_prompt": negative_prompt,
            "cfg_scale": cfg_scale,
        },
    }
    if resolution:
        payload["input"]["resolution"] = resolution

    if callback_url:
        payload["callBackUrl"] = callback_url

    logger.info("[KIE] Submit text2video: model=%s duration=%s aspect_ratio=%s", model, duration, aspect_ratio)
    result = await _post(payload)
    task_id = result.get("data", {}).get("taskId")
    if not task_id:
        raise RuntimeError("KIE createTask returned no taskId")
    return task_id


async def create_image_to_video_task(
    image_url: str,
    prompt: str,
    duration: str = "5",
    aspect_ratio: str = "16:9",
    negative_prompt: str = "blur, distort, low quality",
    cfg_scale: float = 0.5,
    resolution: str | None = None,
    tail_image_url: str | None = None,
    model: str = "kling/v2-5-turbo-image-to-video-pro",
    callback_url: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "input": {
            "image_urls": [image_url],
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "negative_prompt": negative_prompt,
            "cfg_scale": cfg_scale,
        },
    }

    if resolution:
        payload["input"]["resolution"] = resolution
    if tail_image_url:
        payload["input"]["tail_image_url"] = tail_image_url
    if callback_url:
        payload["callBackUrl"] = callback_url

    logger.info("[KIE] Submit image2video: model=%s duration=%s aspect_ratio=%s", model, duration, aspect_ratio)
    result = await _post(payload)
    task_id = result.get("data", {}).get("taskId")
    if not task_id:
        raise RuntimeError("KIE createTask returned no taskId")
    return task_id


async def query_task(task_id: str) -> dict[str, Any]:
    logger.info("[KIE] Query task: %s", task_id)
    result = await _get({"taskId": task_id})
    data = result.get("data", {})
    # Normalize resultJson to dict for downstream consumers
    if isinstance(data.get("resultJson"), str):
        try:
            data["resultJson"] = json.loads(data["resultJson"])
        except json.JSONDecodeError:
            logger.warning("[KIE] Failed to parse resultJson for task %s", task_id)
    return data

