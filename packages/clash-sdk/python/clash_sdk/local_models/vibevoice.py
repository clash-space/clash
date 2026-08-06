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
from .whisper import WhisperLocalAsrRuntime


VIBEVOICE_MODEL = "mlx-community/VibeVoice-ASR-4bit"
VIBEVOICE_ALIGNMENT_MODEL = "mlx-community/whisper-small-mlx"


def _ensure_supported_model(model: str) -> None:
    if Path(model).expanduser().exists() or model == VIBEVOICE_MODEL:
        return
    raise ValueError(f"Unsupported managed VibeVoice model: {model}")


def _field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _speaker_segments(result: Any) -> list[tuple[int, int, str, str]]:
    raw_segments = _field(result, "segments")
    if not isinstance(raw_segments, list):
        raise RuntimeError("VibeVoice returned no speaker segments")
    segments: list[tuple[int, int, str, str]] = []
    for raw in raw_segments:
        start = _field(raw, "start_time")
        end = _field(raw, "end_time")
        speaker = _field(raw, "speaker_id")
        text = _field(raw, "text")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            continue
        speaker_number = int(speaker) + 1 if isinstance(speaker, (int, float)) else len(segments) + 1
        segments.append((
            max(0, round(float(start) * 1000)),
            max(1, round(float(end) * 1000)),
            f"speaker-{speaker_number}",
            str(text or "").strip(),
        ))
    if not segments:
        raise RuntimeError("VibeVoice returned no valid speaker timestamps")
    return segments


def _speaker_for_word(word: LocalAsrWord, segments: list[tuple[int, int, str, str]]) -> str | None:
    midpoint = (word.start_ms + word.end_ms) / 2
    for start_ms, end_ms, speaker_id, _ in segments:
        if start_ms <= midpoint <= end_ms:
            return speaker_id
    overlapping = sorted(
        segments,
        key=lambda segment: max(0, min(word.end_ms, segment[1]) - max(word.start_ms, segment[0])),
        reverse=True,
    )
    if overlapping and max(0, min(word.end_ms, overlapping[0][1]) - max(word.start_ms, overlapping[0][0])) > 0:
        return overlapping[0][2]
    return None


class VibeVoiceLocalAsrRuntime:
    """Long-form speaker diarization combined with Whisper's true word timestamps."""

    def __init__(self, whisper_runtime: Any | None = None):
        self.whisper_runtime = whisper_runtime or WhisperLocalAsrRuntime()
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
        alignment = self.whisper_runtime.status(VIBEVOICE_ALIGNMENT_MODEL, cache_dir)
        if not alignment.available:
            return LocalModelStatus(
                available=False,
                message=f"VibeVoice word alignment is not ready: {alignment.message or VIBEVOICE_ALIGNMENT_MODEL}",
            )
        return LocalModelStatus(available=True)

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "asr",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "asr":
            raise ValueError("VibeVoice only supports ASR models")
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
        self.whisper_runtime.deploy(VIBEVOICE_ALIGNMENT_MODEL, "asr", cache_dir)

    def remove(self, model: str, cache_dir: str | None = None) -> None:
        _ensure_supported_model(model)
        self._models.clear()
        _remove_snapshot(model, cache_dir)

    def warmup(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        _ensure_supported_model(model)
        self._model(_require_cached_snapshot(model, cache_dir))
        alignment_warmup = getattr(self.whisper_runtime, "warmup", None)
        if callable(alignment_warmup):
            return alignment_warmup(VIBEVOICE_ALIGNMENT_MODEL, cache_dir)
        return self.whisper_runtime.status(VIBEVOICE_ALIGNMENT_MODEL, cache_dir)

    def transcribe(
        self,
        model: str,
        audio_path: str,
        language: str | None = None,
        cache_dir: str | None = None,
    ) -> LocalAsrTranscription:
        _ensure_supported_model(model)
        snapshot = _require_cached_snapshot(model, cache_dir)
        diarizer = self._model(snapshot)
        diarized = diarizer.generate(audio=audio_path, max_tokens=8192, temperature=0.0)
        speaker_segments = _speaker_segments(diarized)
        aligned = self.whisper_runtime.transcribe(
            VIBEVOICE_ALIGNMENT_MODEL,
            audio_path,
            language,
            cache_dir,
        )

        words = [LocalAsrWord(
            id=word.id,
            text=word.text,
            start_ms=word.start_ms,
            end_ms=word.end_ms,
            confidence=word.confidence,
            speaker_id=_speaker_for_word(word, speaker_segments),
        ) for word in aligned.words]
        segments: list[LocalAsrSegment] = []
        for start_ms, end_ms, speaker_id, segment_text in speaker_segments:
            segment_words = [word for word in words if word.speaker_id == speaker_id and word.end_ms > start_ms and word.start_ms < end_ms]
            if not segment_words:
                continue
            segments.append(LocalAsrSegment(
                id=f"segment-{len(segments) + 1:06d}",
                text=segment_text or " ".join(word.text for word in segment_words),
                start_ms=segment_words[0].start_ms,
                end_ms=segment_words[-1].end_ms,
                word_ids=[word.id for word in segment_words],
                speaker_id=speaker_id,
            ))
        if not segments:
            raise RuntimeError("VibeVoice speaker timestamps did not overlap Whisper word alignment")
        return LocalAsrTranscription(
            text=aligned.text,
            backend_id="mlx-vibevoice+mlx-whisper",
            model_id=model,
            language=aligned.language or language,
            duration_ms=aligned.duration_ms,
            words=words,
            segments=segments,
        )


__all__ = [
    "VIBEVOICE_ALIGNMENT_MODEL",
    "VIBEVOICE_MODEL",
    "VibeVoiceLocalAsrRuntime",
]
