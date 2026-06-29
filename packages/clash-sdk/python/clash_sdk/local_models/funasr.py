from __future__ import annotations

import importlib.util
import subprocess
import sys
from typing import Any

from . import LocalAsrTranscription, LocalModelKind, LocalModelStatus


def _collect_text(value: Any) -> list[str]:
    texts: list[str] = []
    if isinstance(value, str):
        texts.append(value)
    elif isinstance(value, dict):
        if isinstance(value.get("text"), str):
            texts.append(value["text"])
        for item in value.get("sentence_info") or []:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                texts.append(item["text"])
    elif isinstance(value, list):
        for item in value:
            texts.extend(_collect_text(item))
    return texts


class FunAsrLocalAsrRuntime:
    """FunASR adapter behind the generic local ASR runtime contract."""

    def status(self, model: str) -> LocalModelStatus:
        if importlib.util.find_spec("funasr") is None:
            return LocalModelStatus(
                available=False,
                message="FunASR is not installed in the selected Python environment",
            )
        return LocalModelStatus(available=True)

    def deploy(self, model: str, kind: LocalModelKind = "asr") -> None:
        if kind != "asr":
            raise ValueError("FunASR only supports ASR models")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-U", "funasr", "modelscope", "torch", "torchaudio"],
        )
        from funasr import AutoModel

        AutoModel(model=model, trust_remote_code=True)

    def transcribe(self, model: str, audio_path: str, language: str | None = None) -> LocalAsrTranscription:
        from funasr import AutoModel

        asr_model = AutoModel(model=model, trust_remote_code=True)
        kwargs: dict[str, Any] = {"input": audio_path}
        if language:
            kwargs["language"] = language
        if "sensevoice" in model.lower():
            kwargs["use_itn"] = True
            kwargs["batch_size_s"] = 60
        result = asr_model.generate(**kwargs)
        text = " ".join(_collect_text(result)).strip()
        if not text:
            raise RuntimeError("FunASR returned no transcript")
        return LocalAsrTranscription(text=text)


__all__ = ["FunAsrLocalAsrRuntime"]
