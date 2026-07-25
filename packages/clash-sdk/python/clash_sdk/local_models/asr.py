from __future__ import annotations

from typing import Any

from .funasr import FunAsrLocalAsrRuntime
from .parakeet import ParakeetLocalAsrRuntime
from .vibevoice import VibeVoiceLocalAsrRuntime
from .whisper import WhisperLocalAsrRuntime


def _adapter_name(model: str) -> str:
    normalized = model.lower()
    if "vibevoice" in normalized:
        return "vibevoice"
    if "parakeet" in normalized:
        return "parakeet"
    if "whisper" in normalized:
        return "whisper"
    return "funasr"


class RoutedLocalAsrRuntime:
    """Routes the generic ASR contract to the adapter declared by the model id."""

    def __init__(
        self,
        *,
        funasr_runtime: Any | None = None,
        whisper_runtime: Any | None = None,
        parakeet_runtime: Any | None = None,
        vibevoice_runtime: Any | None = None,
    ):
        self.funasr_runtime = funasr_runtime or FunAsrLocalAsrRuntime()
        self.whisper_runtime = whisper_runtime or WhisperLocalAsrRuntime()
        self.parakeet_runtime = parakeet_runtime or ParakeetLocalAsrRuntime()
        self.vibevoice_runtime = vibevoice_runtime or VibeVoiceLocalAsrRuntime(
            whisper_runtime=self.whisper_runtime,
        )

    def _runtime(self, model: str) -> Any:
        return {
            "funasr": self.funasr_runtime,
            "whisper": self.whisper_runtime,
            "parakeet": self.parakeet_runtime,
            "vibevoice": self.vibevoice_runtime,
        }[_adapter_name(model)]

    def status(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).status(model, cache_dir)

    def deploy(self, model: str, kind: str = "asr", cache_dir: str | None = None):
        return self._runtime(model).deploy(model, kind, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).remove(model, cache_dir)

    def transcribe(self, model: str, audio_path: str, language: str | None = None, cache_dir: str | None = None):
        runtime = self._runtime(model)
        if _adapter_name(model) == "funasr":
            return runtime.transcribe(model, audio_path, language)
        return runtime.transcribe(model, audio_path, language, cache_dir)


__all__ = ["RoutedLocalAsrRuntime"]
