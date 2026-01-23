from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

import httpx

from master_clash.services import kling as beijing_kling
from master_clash.services import r2
from master_clash.services import kling_kie_client
from master_clash.services import minimax_tts
from master_clash.services import elevenlabs_tts
from master_clash.services import kie_elevenlabs_tts
from master_clash.tools.nano_banana import nano_banana_gen, nano_banana_pro_gen

logger = logging.getLogger(__name__)

DEFAULT_IMAGE_MODEL = "nano-banana-pro"
DEFAULT_VIDEO_MODEL = "kling-image2video"
DEFAULT_AUDIO_MODEL = "minimax-tts"


# === Image generation ===
@dataclass
class ImageGenerationRequest:
    prompt: str
    model_id: str = DEFAULT_IMAGE_MODEL
    params: dict[str, Any] = field(default_factory=dict)
    reference_images: list[str] = field(default_factory=list)


@dataclass
class ImageGenerationResult:
    success: bool
    base64_data: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


async def _run_nano_banana(request: ImageGenerationRequest, *, use_pro: bool) -> ImageGenerationResult:
    generator = nano_banana_pro_gen if use_pro else nano_banana_gen
    aspect_ratio = request.params.get("aspect_ratio") or request.params.get("ratio") or "16:9"
    image_size = request.params.get("image_size") or "2K"
    base64_refs = await _ensure_base64_refs(request.reference_images)

    model_name = "nano-banana-pro" if use_pro else "nano-banana"
    logger.info(f"[Generation] Starting {model_name} generation: prompt='{request.prompt[:50]}...', aspect_ratio={aspect_ratio}, image_size={image_size}, refs={len(base64_refs)}")

    try:
        image_base64 = await asyncio.to_thread(
            generator,
            request.prompt,
            "",
            base64_refs,
            aspect_ratio,
            image_size,
        )
        logger.info(f"[Generation] ✅ {model_name} generation successful, image size: {len(image_base64)} bytes")
        return ImageGenerationResult(
            success=True,
            base64_data=image_base64,
            metadata={"model": request.model_id, "aspect_ratio": aspect_ratio, "image_size": image_size},
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[Generation] ❌ {model_name} generation failed: {exc}", exc_info=True)
        return ImageGenerationResult(success=False, error=str(exc))


async def generate_image(request: ImageGenerationRequest) -> ImageGenerationResult:
    model_id = request.model_id or DEFAULT_IMAGE_MODEL
    if model_id == "nano-banana":
        return await _run_nano_banana(request, use_pro=False)
    if model_id == "nano-banana-pro":
        return await _run_nano_banana(request, use_pro=True)

    return ImageGenerationResult(success=False, error=f"Unsupported image model: {model_id}")


def _is_valid_base64(value: str) -> bool:
    try:
        base64.b64decode(value.strip(), validate=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def _strip_data_uri(ref: str) -> tuple[str, bool]:
    if ref.startswith("data:") and "," in ref:
        payload = ref.split(",", 1)[1]
        return payload, _is_valid_base64(payload)
    if "base64," in ref:
        payload = ref.split("base64,", 1)[1]
        return payload, _is_valid_base64(payload)
    return ref, False


async def _fetch_http_bytes(url: str) -> bytes:
    async with r2.get_http_client() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


async def _ensure_base64_refs(reference_images: list[str]) -> list[str]:
    normalized: list[str] = []
    for ref in reference_images:
        if not isinstance(ref, str):
            continue
        candidate = ref.strip()
        if not candidate:
            continue

        candidate, was_base64 = _strip_data_uri(candidate)
        if was_base64 or _is_valid_base64(candidate):
            normalized.append(candidate)
            continue

        try:
            if candidate.startswith(("http://", "https://")):
                data = await _fetch_http_bytes(candidate)
                normalized.append(base64.b64encode(data).decode("utf-8"))
                continue
            if os.path.exists(candidate):
                with open(candidate, "rb") as handle:
                    normalized.append(base64.b64encode(handle.read()).decode("utf-8"))
                continue

            data, _ = await r2.fetch_object(candidate)
            normalized.append(base64.b64encode(data).decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Generation] Failed to resolve reference image: %s (%s)", candidate, exc)

    return normalized


# === Video generation ===
@dataclass
class VideoGenerationRequest:
    prompt: str
    project_id: str
    model_id: str = DEFAULT_VIDEO_MODEL
    params: dict[str, Any] = field(default_factory=dict)
    reference_images: list[str] = field(default_factory=list)
    callback_url: str | None = None
    task_id: str | None = None


@dataclass
class VideoSubmissionResult:
    success: bool
    provider: str
    model_id: str
    external_task_id: str | None = None
    r2_key: str | None = None
    error: str | None = None


@dataclass
class VideoPollResult:
    status: Literal["pending", "completed", "failed"]
    r2_key: str | None = None
    error: str | None = None


VideoSubmitHandler = Callable[[VideoGenerationRequest], Awaitable[VideoSubmissionResult]]
VideoPollHandler = Callable[[str, str], Awaitable[VideoPollResult]]


def _coerce_duration(value: Any, *, default: int = 5) -> int:
    try:
        return int(value)
    except Exception:  # noqa: BLE001
        return default


async def _ensure_r2_keys(reference_images: list[str], project_id: str) -> list[str]:
    normalized: list[str] = []
    for idx, ref in enumerate(reference_images):
        if ref.startswith("http://") or ref.startswith("https://"):
            normalized.append(ref)
            continue
        if ref.startswith("data:"):
            try:
                encoded = ref.split(",", 1)[1]
                image_bytes = base64.b64decode(encoded)
                r2_key = f"projects/{project_id}/generated/ref_{int(time.time())}_{idx}.png"
                await r2.put_object(r2_key, image_bytes, "image/png")
                normalized.append(r2_key)
                continue
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Generation] Failed to parse base64 reference: %s", exc)
        normalized.append(ref)
    return normalized


async def _submit_kling_image2video(request: VideoGenerationRequest) -> VideoSubmissionResult:
    normalized_refs = await _ensure_r2_keys(request.reference_images, request.project_id)
    image_r2_key = request.params.get("image_r2_key") or (normalized_refs[0] if normalized_refs else None)
    if not image_r2_key:
        return VideoSubmissionResult(
            success=False,
            provider="kling",
            model_id=request.model_id,
            error="image_r2_key is required for Kling image2video",
        )

    duration = _coerce_duration(request.params.get("duration", 5))
    model_name = request.params.get("model") or "kling-v1"

    submit_result = await beijing_kling.submit_video(
        prompt=request.prompt,
        image_r2_key=image_r2_key,
        duration=duration,
        model=model_name,
    )

    if not submit_result.get("success"):
        return VideoSubmissionResult(
            success=False,
            provider="kling",
            model_id=request.model_id,
            error=submit_result.get("error", "Kling submit failed"),
        )

    return VideoSubmissionResult(
        success=True,
        provider="kling",
        model_id=request.model_id,
        external_task_id=submit_result.get("external_task_id"),
    )


async def _poll_kling_image2video(external_task_id: str, project_id: str) -> VideoPollResult:
    poll_result = await beijing_kling.poll_video(external_task_id, project_id)
    status = poll_result.get("status")

    if status == "completed":
        return VideoPollResult(status="completed", r2_key=poll_result.get("r2_key"))
    if status == "failed":
        return VideoPollResult(status="failed", error=poll_result.get("error"))
    return VideoPollResult(status="pending")


def _public_r2_url(key: str) -> str:
    if key.startswith("http://") or key.startswith("https://"):
        return key
    base = r2.get_public_base_url().rstrip("/")
    return f"{base}/{key}"



def _get_kie_model_name(model_id: str) -> str:
    if model_id == "kling-kie-text2video":
        return "kling/v2-5-turbo-text-to-video-pro"
    if model_id == "kling-kie-image2video":
        return "kling/v2-5-turbo-image-to-video-pro"
    return model_id


async def _submit_kie_text2video(request: VideoGenerationRequest) -> VideoSubmissionResult:
    params = request.params
    kie_model = _get_kie_model_name(request.model_id)

    try:
        task_id = await kling_kie_client.create_text_to_video_task(
            prompt=request.prompt,
            duration=str(params.get("duration", "5")),
            aspect_ratio=str(params.get("aspect_ratio", "16:9")),
            negative_prompt=str(params.get("negative_prompt", "blur, distort, low quality")),
            cfg_scale=float(params.get("cfg_scale", 0.5)),
            resolution=params.get("resolution"),
            model=kie_model,
            callback_url=request.callback_url,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("[Generation] KIE text2video error: %s", exc, exc_info=True)
        return VideoSubmissionResult(
            success=False,
            provider="kling-kie",
            model_id=request.model_id,
            error=str(exc),
        )

    return VideoSubmissionResult(
        success=True,
        provider="kling-kie",
        model_id=request.model_id,
        external_task_id=task_id,
    )


async def _submit_kie_image2video(request: VideoGenerationRequest) -> VideoSubmissionResult:
    normalized_refs = await _ensure_r2_keys(request.reference_images, request.project_id)
    reference = normalized_refs[0] if normalized_refs else None
    if not reference:
        return VideoSubmissionResult(
            success=False,
            provider="kling-kie",
            model_id=request.model_id,
            error="Reference image is required for Kling KIE image-to-video",
        )

    params = request.params
    image_url = _public_r2_url(reference)
    tail_image_url = params.get("tail_image_url")
    kie_model = _get_kie_model_name(request.model_id)

    try:
        task_id = await kling_kie_client.create_image_to_video_task(
            image_url=image_url,
            prompt=request.prompt,
            duration=str(params.get("duration", "5")),
            aspect_ratio=str(params.get("aspect_ratio", "16:9")),
            negative_prompt=str(params.get("negative_prompt", "blur, distort, low quality")),
            cfg_scale=float(params.get("cfg_scale", 0.5)),
            resolution=params.get("resolution"),
            tail_image_url=tail_image_url,
            model=kie_model,
            callback_url=request.callback_url,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("[Generation] KIE image2video error: %s", exc, exc_info=True)
        return VideoSubmissionResult(
            success=False,
            provider="kling-kie",
            model_id=request.model_id,
            error=str(exc),
        )

    return VideoSubmissionResult(
        success=True,
        provider="kling-kie",
        model_id=request.model_id,
        external_task_id=task_id,
    )


async def _poll_kie_video(external_task_id: str, project_id: str) -> VideoPollResult:
    try:
        task_data = await kling_kie_client.query_task(external_task_id)
    except Exception as exc:  # noqa: BLE001
        return VideoPollResult(status="failed", error=str(exc))

    state = task_data.get("state")
    if state == "waiting":
        return VideoPollResult(status="pending")
    if state == "fail":
        return VideoPollResult(status="failed", error=task_data.get("failMsg", "KIE task failed"))

    result_json = task_data.get("resultJson") or {}
    urls: list[str] = []
    if isinstance(result_json, dict):
        urls = result_json.get("resultUrls") or result_json.get("resulturls") or []
    if not urls:
        return VideoPollResult(status="failed", error="No resultUrls returned by KIE")

    video_url = urls[0]
    async with httpx.AsyncClient(timeout=120.0) as client:
        video_resp = await client.get(video_url)
        if video_resp.status_code != 200:
            return VideoPollResult(
                status="failed",
                error=f"Download failed: HTTP {video_resp.status_code}",
            )
        r2_key = f"projects/{project_id}/generated/vid_{external_task_id}.mp4"
        await r2.put_object(r2_key, video_resp.content, "video/mp4")
        return VideoPollResult(status="completed", r2_key=r2_key)


async def _submit_remotion_mg(request: VideoGenerationRequest) -> VideoSubmissionResult:
    from master_clash.services.mg_animation import render_mg_animation

    task_id = request.task_id or f"mg_{int(time.time())}"
    result = await render_mg_animation(
        description=request.prompt,
        project_id=request.project_id,
        task_id=task_id,
        params=request.params,
    )

    if not result.success:
        return VideoSubmissionResult(
            success=False,
            provider="remotion",
            model_id=request.model_id,
            error=result.error or "Remotion MG render failed",
        )

    return VideoSubmissionResult(
        success=True,
        provider="remotion",
        model_id=request.model_id,
        r2_key=result.r2_key,
    )


VIDEO_SUBMIT_HANDLERS: dict[str, VideoSubmitHandler] = {
    "kling-image2video": _submit_kling_image2video,
    "kling-kie-text2video": _submit_kie_text2video,
    "kling-kie-image2video": _submit_kie_image2video,
    "sora-2-pro-text-to-video": _submit_kie_text2video,
    "sora-2-pro-image-to-video": _submit_kie_image2video,
    "sora-2-characters": _submit_kie_image2video,
    "sora-2-pro-storyboard": _submit_kie_text2video,
    "remotion-mg": _submit_remotion_mg,
}

VIDEO_POLL_HANDLERS: dict[str, VideoPollHandler] = {
    "kling-image2video": _poll_kling_image2video,
    "kling-kie-text2video": _poll_kie_video,
    "kling-kie-image2video": _poll_kie_video,
    "sora-2-pro-text-to-video": _poll_kie_video,
    "sora-2-pro-image-to-video": _poll_kie_video,
    "sora-2-characters": _poll_kie_video,
    "sora-2-pro-storyboard": _poll_kie_video,
}


async def submit_video_job(request: VideoGenerationRequest) -> VideoSubmissionResult:
    model_id = request.model_id or DEFAULT_VIDEO_MODEL
    handler = VIDEO_SUBMIT_HANDLERS.get(model_id)
    if not handler:
        return VideoSubmissionResult(
            success=False,
            provider="unknown",
            model_id=model_id,
            error=f"Unsupported video model: {model_id}",
        )
    return await handler(request)


async def poll_video_job(model_id: str, external_task_id: str, project_id: str) -> VideoPollResult:
    handler = VIDEO_POLL_HANDLERS.get(model_id) or VIDEO_POLL_HANDLERS.get(DEFAULT_VIDEO_MODEL)
    if not handler:
        return VideoPollResult(status="failed", error=f"No poller for model {model_id}")
    return await handler(external_task_id, project_id)


# === Audio generation (TTS) ===
@dataclass
class AudioGenerationRequest:
    """Request for audio/TTS generation."""
    text: str
    project_id: str
    model_id: str = DEFAULT_AUDIO_MODEL
    params: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None  # Provider override: 'official', 'kie', etc.


@dataclass
class AudioGenerationResult:
    """Result from audio/TTS generation."""
    success: bool
    audio_bytes: bytes | None = None
    r2_key: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


async def _run_minimax_tts(request: AudioGenerationRequest) -> AudioGenerationResult:
    """Generate speech using MiniMax TTS."""
    params = request.params

    tts_request = minimax_tts.TTSRequest(
        text=request.text,
        voice_id=params.get("voice_id", "female-warm"),
        speed=float(params.get("speed", 1.0)),
        pitch=int(params.get("pitch", 0)),
        model=params.get("model", "speech-01"),
    )

    result = await minimax_tts.generate_speech(tts_request)

    if not result.success:
        return AudioGenerationResult(success=False, error=result.error)

    # Decode base64 audio data
    audio_bytes = base64.b64decode(result.audio_base64)

    # Upload to R2
    r2_key = f"projects/{request.project_id}/generated/{int(time.time())}.mp3"
    await r2.put_object(r2_key, audio_bytes, "audio/mpeg")

    return AudioGenerationResult(
        success=True,
        audio_bytes=audio_bytes,
        r2_key=r2_key,
        metadata=result.metadata or {},
    )


async def _run_elevenlabs_tts(request: AudioGenerationRequest, provider: str = "official") -> AudioGenerationResult:
    """
    Generate speech using ElevenLabs TTS.

    Args:
        request: Audio generation request
        provider: Provider to use ('official' for ElevenLabs API, 'kie' for KIE.ai)
    """
    params = request.params

    tts_request_data = {
        "text": request.text,
        "voice_id": params.get("voice_id", "rachel"),
        "model_id": params.get("model_id", "eleven_multilingual_v2"),
        "stability": float(params.get("stability", 0.5)),
        "similarity_boost": float(params.get("similarity_boost", 0.75)),
    }

    # Select provider
    if provider == "kie":
        logger.info("[Generation] Using KIE.ai provider for ElevenLabs TTS")
        tts_request = kie_elevenlabs_tts.TTSRequest(**tts_request_data)
        result = await kie_elevenlabs_tts.generate_speech(tts_request)
    else:
        logger.info("[Generation] Using official ElevenLabs API")
        tts_request = elevenlabs_tts.TTSRequest(**tts_request_data)
        result = await elevenlabs_tts.generate_speech(tts_request)

    if not result.success:
        return AudioGenerationResult(success=False, error=result.error)

    # Upload to R2
    r2_key = f"projects/{request.project_id}/generated/{int(time.time())}.mp3"
    await r2.put_object(r2_key, result.audio_bytes, "audio/mpeg")

    return AudioGenerationResult(
        success=True,
        audio_bytes=result.audio_bytes,
        r2_key=r2_key,
        metadata=result.metadata or {},
    )


async def generate_audio(request: AudioGenerationRequest) -> AudioGenerationResult:
    """
    Generate audio/speech from text.

    Supported models:
    - minimax-tts: MiniMax TTS (Chinese & English)
    - elevenlabs-tts: ElevenLabs TTS (High quality, English)
      - Providers: 'official' (default), 'kie' (via KIE.ai)

    Provider can be specified via request.provider or request.params['provider']
    """
    model_id = request.model_id or DEFAULT_AUDIO_MODEL

    # Get provider preference (from request or params)
    provider = request.provider or request.params.get("provider", "official")

    if model_id == "minimax-tts":
        return await _run_minimax_tts(request)
    if model_id == "elevenlabs-tts":
        return await _run_elevenlabs_tts(request, provider=provider)

    return AudioGenerationResult(
        success=False,
        error=f"Unsupported audio model: {model_id}"
    )
