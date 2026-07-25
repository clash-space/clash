from __future__ import annotations

import importlib.util
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import (
    LocalAsrSegment,
    LocalAsrTranscription,
    LocalAsrWord,
    LocalModelKind,
    LocalModelStatus,
)

_RICH_TOKEN = re.compile(r"<\|[^|>]+\|>")


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return _RICH_TOKEN.sub("", value).strip()


def _result_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        items: list[dict[str, Any]] = []
        for item in value:
            items.extend(_result_items(item))
        return items
    return []


def _timestamp_pair(value: Any) -> tuple[int, int] | None:
    if isinstance(value, dict):
        start = value.get("start", value.get("start_ms"))
        end = value.get("end", value.get("end_ms"))
    elif isinstance(value, (list, tuple)) and len(value) >= 2:
        start, end = value[0], value[1]
    else:
        return None
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    start_ms = max(0, int(round(start)))
    end_ms = max(0, int(round(end)))
    return (start_ms, end_ms) if end_ms > start_ms else None


def _aligned_tokens(item: dict[str, Any], count: int) -> list[str]:
    raw_words = item.get("words")
    if isinstance(raw_words, list):
        words = [_clean_text(word) for word in raw_words]
        if len(words) == count and all(words):
            return words

    text = _clean_text(item.get("text"))
    whitespace_tokens = text.split()
    if len(whitespace_tokens) == count:
        return whitespace_tokens
    compact_tokens = [character for character in text if not character.isspace()]
    if len(compact_tokens) == count:
        return compact_tokens
    raise RuntimeError(
        "FunASR returned timestamps without an aligned word/token list; "
        "use a timestamp-capable model such as SenseVoiceSmall or Paraformer",
    )


def _normalize_transcription(
    result: Any,
    *,
    model: str,
    language: str | None,
) -> LocalAsrTranscription:
    words: list[LocalAsrWord] = []
    segments: list[LocalAsrSegment] = []
    transcript_texts: list[str] = []

    for item in _result_items(result):
        raw_timestamps = item.get("timestamp", item.get("timestamps"))
        if not isinstance(raw_timestamps, list) or not raw_timestamps:
            continue
        timestamp_pairs = [_timestamp_pair(value) for value in raw_timestamps]
        if any(pair is None for pair in timestamp_pairs):
            raise RuntimeError("FunASR returned an invalid word timestamp range")
        pairs = [pair for pair in timestamp_pairs if pair is not None]
        tokens = _aligned_tokens(item, len(pairs))
        segment_word_ids: list[str] = []
        for token, (start_ms, end_ms) in zip(tokens, pairs):
            word_id = f"word-{len(words) + 1:06d}"
            words.append(LocalAsrWord(
                id=word_id,
                text=token,
                start_ms=start_ms,
                end_ms=end_ms,
            ))
            segment_word_ids.append(word_id)

        item_text = _clean_text(item.get("text")) or "".join(tokens)
        transcript_texts.append(item_text)
        segment_index = len(segments) + 1
        segments.append(LocalAsrSegment(
            id=f"segment-{segment_index:06d}",
            text=item_text,
            start_ms=pairs[0][0],
            end_ms=pairs[-1][1],
            word_ids=segment_word_ids,
            speaker_id=str(item["spk"]) if item.get("spk") is not None else None,
        ))

    if not words:
        raise RuntimeError(
            "FunASR returned no word timestamps; this transcript requires word alignment",
        )
    text = " ".join(value for value in transcript_texts if value).strip()
    if not text:
        raise RuntimeError("FunASR returned no transcript")
    return LocalAsrTranscription(
        text=text,
        backend_id="funasr",
        model_id=model,
        language=language,
        duration_ms=max(word.end_ms for word in words),
        words=words,
        segments=segments,
    )


class FunAsrLocalAsrRuntime:
    """FunASR adapter behind the generic local ASR runtime contract."""

    def status(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        if importlib.util.find_spec("funasr") is None:
            return LocalModelStatus(
                available=False,
                message="FunASR is not installed in the selected Python environment",
            )
        if Path(model).expanduser().exists():
            return LocalModelStatus(available=True)
        if importlib.util.find_spec("modelscope") is None:
            return LocalModelStatus(
                available=False,
                message="ModelScope is not installed, so the FunASR model cache cannot be checked",
            )
        try:
            from modelscope.hub.snapshot_download import snapshot_download

            snapshot_download(model, local_files_only=True)
        except Exception:
            return LocalModelStatus(
                available=False,
                message=f"FunASR model {model} is not downloaded",
            )
        return LocalModelStatus(available=True)

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "asr",
        cache_dir: str | None = None,
    ) -> None:
        if kind != "asr":
            raise ValueError("FunASR only supports ASR models")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-U", "funasr", "modelscope", "torch", "torchaudio"],
        )
        from funasr import AutoModel

        AutoModel(model=model, trust_remote_code=True)

    def remove(self, model: str, cache_dir: str | None = None) -> None:
        explicit_path = Path(model).expanduser()
        if explicit_path.exists():
            raise ValueError("Refusing to remove an explicit local ASR model path")
        if importlib.util.find_spec("modelscope") is None:
            return
        try:
            from modelscope.hub.snapshot_download import snapshot_download

            cached_path = Path(
                snapshot_download(model, local_files_only=True),
            ).expanduser()
        except Exception:
            return
        if cached_path.exists():
            shutil.rmtree(cached_path)

    def transcribe(self, model: str, audio_path: str, language: str | None = None) -> LocalAsrTranscription:
        from funasr import AutoModel

        asr_model = AutoModel(model=model, trust_remote_code=True)
        kwargs: dict[str, Any] = {"input": audio_path}
        if language:
            kwargs["language"] = language
        if "sensevoice" in model.lower():
            kwargs["use_itn"] = True
            kwargs["batch_size_s"] = 60
        kwargs["output_timestamp"] = True
        kwargs["pred_timestamp"] = True
        result = asr_model.generate(**kwargs)
        return _normalize_transcription(result, model=model, language=language)


__all__ = ["FunAsrLocalAsrRuntime"]
