from __future__ import annotations

import struct
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any, Iterable

from . import LocalModelKind, LocalModelStatus, LocalTtsSynthesis
from ._mlx_hub import (
    download_snapshot as _download_snapshot,
    module_available as _module_available,
    remove_snapshot as _remove_snapshot,
    require_apple_silicon as _require_apple_silicon,
    require_cached_snapshot as _require_cached_snapshot,
)


KOKORO_MODEL = "mlx-community/Kokoro-82M-4bit"


def _ensure_supported_model(model: str) -> None:
    if Path(model).expanduser().exists() or model == KOKORO_MODEL:
        return
    raise ValueError(f"Unsupported managed Kokoro model: {model}")


def _language_code(voice: str) -> str:
    prefix = voice[:1].lower()
    if prefix in {"a", "b", "j", "z", "e", "f", "h", "i", "p"}:
        return prefix
    return "a"


def _flatten_audio(value: Any) -> Iterable[float]:
    raw = value.tolist() if hasattr(value, "tolist") else value
    if not isinstance(raw, (list, tuple)):
        raise RuntimeError("Kokoro returned an unsupported audio buffer")
    for sample in raw:
        if isinstance(sample, (list, tuple)):
            yield from _flatten_audio(sample)
        elif isinstance(sample, (int, float)) and not isinstance(sample, bool):
            yield float(sample)


def _write_pcm_wav(path: Path, chunks: list[Any], sample_rate: int) -> int:
    samples = [max(-1.0, min(1.0, sample)) for chunk in chunks for sample in _flatten_audio(chunk)]
    if not samples:
        raise RuntimeError("Kokoro returned no audio samples")
    pcm = b"".join(struct.pack("<h", int(round(sample * 32767))) for sample in samples)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
    return max(1, round(len(samples) * 1000 / sample_rate))


class KokoroLocalTtsRuntime:
    """Small, multilingual local TTS using MLX-Audio's Kokoro adapter."""

    def __init__(self) -> None:
        self._models: dict[str, Any] = {}

    def _model(self, snapshot: Path) -> Any:
        key = str(snapshot)
        cached = self._models.get(key)
        if cached is not None:
            return cached
        from mlx_audio.tts.utils import load_model

        loaded = load_model(key)
        self._models[key] = loaded
        return loaded

    def status(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        try:
            _ensure_supported_model(model)
        except ValueError as exc:
            return LocalModelStatus(available=False, message=str(exc))
        if not _module_available("mlx_audio"):
            return LocalModelStatus(available=False, message="MLX-Audio is not installed")
        try:
            _require_cached_snapshot(model, cache_dir)
        except Exception as exc:
            return LocalModelStatus(available=False, message=str(exc))
        return LocalModelStatus(available=True)

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "tts",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "tts":
            raise ValueError("Kokoro only supports TTS models")
        _ensure_supported_model(model)
        _require_apple_silicon()
        subprocess.check_call([
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "mlx-audio",
            "misaki[zh,ja]",
            "huggingface_hub[hf_xet]",
        ])
        _download_snapshot(model, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None) -> None:
        _ensure_supported_model(model)
        self._models.clear()
        _remove_snapshot(model, cache_dir)

    def warmup(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        _ensure_supported_model(model)
        self._model(_require_cached_snapshot(model, cache_dir))
        return LocalModelStatus(available=True)

    def synthesize(
        self,
        model: str,
        text: str,
        output_path: str,
        cache_dir: str | None = None,
        voice: str | None = None,
        speed: float | None = None,
    ) -> LocalTtsSynthesis:
        if not text.strip():
            raise ValueError("text is required")
        _ensure_supported_model(model)
        snapshot = _require_cached_snapshot(model, cache_dir)
        tts = self._model(snapshot)
        voice_id = voice or "af_heart"
        speed_value = speed or 1.0
        chunks = [result.audio for result in tts.generate(
            text=text.strip(),
            voice=voice_id,
            speed=speed_value,
            lang_code=_language_code(voice_id),
        )]
        sample_rate = int(getattr(tts, "sample_rate", 24000))
        output = Path(output_path).expanduser().resolve()
        duration_ms = _write_pcm_wav(output, chunks, sample_rate)
        return LocalTtsSynthesis(
            backend_id="mlx-kokoro",
            model_id=model,
            voice_id=voice_id,
            sample_rate=sample_rate,
            duration_ms=duration_ms,
            output_path=str(output),
        )


__all__ = ["KOKORO_MODEL", "KokoroLocalTtsRuntime"]
