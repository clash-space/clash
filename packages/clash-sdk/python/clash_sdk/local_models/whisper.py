from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from . import LocalAsrSegment, LocalAsrTranscription, LocalAsrWord, LocalModelKind, LocalModelStatus
from ._mlx_hub import (
    download_snapshot as _download_snapshot,
    module_available as _module_available,
    remove_snapshot as _remove_snapshot,
    require_apple_silicon as _require_apple_silicon,
    require_cached_snapshot as _require_cached_snapshot,
)


SUPPORTED_WHISPER_MODELS = {
    "mlx-community/whisper-large-v3-turbo",
    "mlx-community/whisper-small-mlx",
}


def _ensure_supported_model(model: str) -> None:
    if Path(model).expanduser().exists():
        return
    if model not in SUPPORTED_WHISPER_MODELS:
        raise ValueError(f"Unsupported managed MLX Whisper model: {model}")


def _seconds_to_ms(value: Any) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise RuntimeError("MLX Whisper returned an invalid timestamp")
    return max(0, int(round(float(value) * 1000)))


def _normalize_transcription(result: Any, *, model: str, language: str | None) -> LocalAsrTranscription:
    if not isinstance(result, dict):
        raise RuntimeError("MLX Whisper returned no structured transcript")
    raw_segments = result.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise RuntimeError("MLX Whisper returned no timed segments")

    words: list[LocalAsrWord] = []
    segments: list[LocalAsrSegment] = []
    for raw_segment in raw_segments:
        if not isinstance(raw_segment, dict):
            continue
        raw_words = raw_segment.get("words")
        if not isinstance(raw_words, list) or not raw_words:
            raise RuntimeError("MLX Whisper returned a segment without word timestamps")
        segment_word_ids: list[str] = []
        for raw_word in raw_words:
            if not isinstance(raw_word, dict):
                continue
            text = str(raw_word.get("word", "")).strip()
            if not text:
                continue
            start_ms = _seconds_to_ms(raw_word.get("start"))
            end_ms = _seconds_to_ms(raw_word.get("end"))
            if end_ms <= start_ms:
                continue
            word_id = f"word-{len(words) + 1:06d}"
            probability = raw_word.get("probability")
            words.append(LocalAsrWord(
                id=word_id,
                text=text,
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=float(probability) if isinstance(probability, (int, float)) else None,
            ))
            segment_word_ids.append(word_id)
        if not segment_word_ids:
            continue
        segment_words = words[-len(segment_word_ids):]
        segment_text = str(raw_segment.get("text", "")).strip() or " ".join(word.text for word in segment_words)
        segments.append(LocalAsrSegment(
            id=f"segment-{len(segments) + 1:06d}",
            text=segment_text,
            start_ms=segment_words[0].start_ms,
            end_ms=segment_words[-1].end_ms,
            word_ids=segment_word_ids,
        ))

    if not words:
        raise RuntimeError("MLX Whisper returned no word timestamps")
    text = str(result.get("text", "")).strip() or " ".join(word.text for word in words)
    detected_language = result.get("language")
    return LocalAsrTranscription(
        text=text,
        backend_id="mlx-whisper",
        model_id=model,
        language=language or (str(detected_language) if detected_language else None),
        duration_ms=max(word.end_ms for word in words),
        words=words,
        segments=segments,
    )


class WhisperLocalAsrRuntime:
    """Word-aligned Whisper inference accelerated with MLX on Apple Silicon."""

    def status(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        try:
            _ensure_supported_model(model)
        except ValueError as exc:
            return LocalModelStatus(available=False, message=str(exc))
        if not _module_available("mlx_whisper"):
            return LocalModelStatus(available=False, message="MLX Whisper is not installed")
        try:
            _require_cached_snapshot(model, cache_dir)
        except Exception as exc:
            return LocalModelStatus(available=False, message=str(exc))
        return LocalModelStatus(available=True)

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "asr",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "asr":
            raise ValueError("MLX Whisper only supports ASR models")
        _ensure_supported_model(model)
        _require_apple_silicon()
        subprocess.check_call([
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "mlx-whisper",
            "huggingface_hub[hf_xet]",
        ])
        _download_snapshot(model, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None) -> None:
        _ensure_supported_model(model)
        _remove_snapshot(model, cache_dir)

    def transcribe(
        self,
        model: str,
        audio_path: str,
        language: str | None = None,
        cache_dir: str | None = None,
    ) -> LocalAsrTranscription:
        _ensure_supported_model(model)
        snapshot = _require_cached_snapshot(model, cache_dir)
        import mlx_whisper

        kwargs: dict[str, Any] = {
            "path_or_hf_repo": str(snapshot),
            "word_timestamps": True,
        }
        if language:
            kwargs["language"] = language
        result = mlx_whisper.transcribe(audio_path, **kwargs)
        return _normalize_transcription(result, model=model, language=language)


__all__ = ["SUPPORTED_WHISPER_MODELS", "WhisperLocalAsrRuntime"]
