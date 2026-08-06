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


PARAKEET_MODEL = "mlx-community/parakeet-tdt-0.6b-v3"


def _ensure_supported_model(model: str) -> None:
    if Path(model).expanduser().exists() or model == PARAKEET_MODEL:
        return
    raise ValueError(f"Unsupported managed MLX-Audio Parakeet model: {model}")


def _field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _seconds_to_ms(value: Any) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise RuntimeError("MLX-Audio Parakeet returned an invalid timestamp")
    return max(0, int(round(float(value) * 1000)))


def _token_range(token: Any) -> tuple[int, int]:
    start = _field(token, "start")
    end = _field(token, "end")
    if not isinstance(end, (int, float)) or isinstance(end, bool):
        duration = _field(token, "duration")
        if not isinstance(start, (int, float)) or isinstance(start, bool):
            raise RuntimeError("MLX-Audio Parakeet returned an invalid token start")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool):
            raise RuntimeError("MLX-Audio Parakeet returned a token without duration")
        end = float(start) + float(duration)
    start_ms = _seconds_to_ms(start)
    end_ms = _seconds_to_ms(end)
    if end_ms <= start_ms:
        raise RuntimeError("MLX-Audio Parakeet returned an invalid token timestamp range")
    return start_ms, end_ms


def _sentence_words(sentence: Any) -> list[tuple[str, int, int]]:
    raw_tokens = _field(sentence, "tokens")
    if not isinstance(raw_tokens, list) or not raw_tokens:
        raise RuntimeError("MLX-Audio Parakeet returned a sentence without aligned tokens")

    merged: list[tuple[str, int, int]] = []
    current_text = ""
    current_start = 0
    current_end = 0

    def flush() -> None:
        nonlocal current_text, current_start, current_end
        if current_text:
            merged.append((current_text, current_start, current_end))
        current_text = ""
        current_start = 0
        current_end = 0

    for token in raw_tokens:
        raw_text = _field(token, "text")
        if not isinstance(raw_text, str) or not raw_text.strip():
            continue
        start_ms, end_ms = _token_range(token)
        starts_word = raw_text[:1].isspace()
        piece = raw_text.strip()
        if current_text and starts_word:
            flush()
        if not current_text:
            current_text = piece
            current_start = start_ms
            current_end = end_ms
        else:
            current_text += piece
            current_end = max(current_end, end_ms)
    flush()

    if not merged:
        raise RuntimeError("MLX-Audio Parakeet returned no aligned words")
    return merged


def _normalize_transcription(
    result: Any,
    *,
    model: str,
    language: str | None,
) -> LocalAsrTranscription:
    raw_sentences = _field(result, "sentences")
    if not isinstance(raw_sentences, list) or not raw_sentences:
        raise RuntimeError("MLX-Audio Parakeet returned no aligned sentences")

    words: list[LocalAsrWord] = []
    segments: list[LocalAsrSegment] = []
    for raw_sentence in raw_sentences:
        aligned_words = _sentence_words(raw_sentence)
        word_ids: list[str] = []
        for word_text, start_ms, end_ms in aligned_words:
            word_id = f"word-{len(words) + 1:06d}"
            words.append(LocalAsrWord(
                id=word_id,
                text=word_text,
                start_ms=start_ms,
                end_ms=end_ms,
            ))
            word_ids.append(word_id)
        sentence_text = _field(raw_sentence, "text")
        if not isinstance(sentence_text, str) or not sentence_text.strip():
            sentence_text = " ".join(text for text, _, _ in aligned_words)
        segments.append(LocalAsrSegment(
            id=f"segment-{len(segments) + 1:06d}",
            text=sentence_text.strip(),
            start_ms=aligned_words[0][1],
            end_ms=aligned_words[-1][2],
            word_ids=word_ids,
        ))

    if not words:
        raise RuntimeError("MLX-Audio Parakeet returned no word timestamps")
    text = _field(result, "text")
    if not isinstance(text, str) or not text.strip():
        text = " ".join(segment.text for segment in segments)
    detected_language = _field(result, "language")
    return LocalAsrTranscription(
        text=text.strip(),
        backend_id="mlx-parakeet",
        model_id=model,
        language=language or (str(detected_language) if detected_language else None),
        duration_ms=max(word.end_ms for word in words),
        words=words,
        segments=segments,
    )


class ParakeetLocalAsrRuntime:
    """Multilingual European-language ASR with native Parakeet token timing."""

    def __init__(self) -> None:
        self._models: dict[str, Any] = {}

    def _model(self, snapshot: Path) -> Any:
        key = str(snapshot)
        cached = self._models.get(key)
        if cached is not None:
            return cached
        from mlx_audio.stt.utils import load

        loaded = load(key)
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
        kind: LocalModelKind = "asr",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "asr":
            raise ValueError("MLX-Audio Parakeet only supports ASR models")
        _ensure_supported_model(model)
        _require_apple_silicon()
        subprocess.check_call([
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "mlx-audio",
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

    def transcribe(
        self,
        model: str,
        audio_path: str,
        language: str | None = None,
        cache_dir: str | None = None,
    ) -> LocalAsrTranscription:
        _ensure_supported_model(model)
        snapshot = _require_cached_snapshot(model, cache_dir)
        asr_model = self._model(snapshot)
        result = asr_model.generate(audio_path)
        return _normalize_transcription(result, model=model, language=language)


__all__ = ["PARAKEET_MODEL", "ParakeetLocalAsrRuntime"]
