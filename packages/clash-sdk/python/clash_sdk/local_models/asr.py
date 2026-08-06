from __future__ import annotations

from typing import Any


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
        self._runtimes = {
            name: runtime
            for name, runtime in {
                "funasr": funasr_runtime,
                "whisper": whisper_runtime,
                "parakeet": parakeet_runtime,
                "vibevoice": vibevoice_runtime,
            }.items()
            if runtime is not None
        }

    def _named_runtime(self, name: str) -> Any:
        cached = self._runtimes.get(name)
        if cached is not None:
            return cached
        if name == "funasr":
            from .funasr import FunAsrLocalAsrRuntime

            runtime = FunAsrLocalAsrRuntime()
        elif name == "whisper":
            from .whisper import WhisperLocalAsrRuntime

            runtime = WhisperLocalAsrRuntime()
        elif name == "parakeet":
            from .parakeet import ParakeetLocalAsrRuntime

            runtime = ParakeetLocalAsrRuntime()
        elif name == "vibevoice":
            from .vibevoice import VibeVoiceLocalAsrRuntime

            runtime = VibeVoiceLocalAsrRuntime(
                whisper_runtime=self._named_runtime("whisper"),
            )
        else:
            raise ValueError(f"Unsupported local ASR adapter: {name}")
        self._runtimes[name] = runtime
        return runtime

    def _runtime(self, model: str) -> Any:
        return self._named_runtime(_adapter_name(model))

    def status(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).status(model, cache_dir)

    def deploy(self, model: str, kind: str = "asr", cache_dir: str | None = None):
        return self._runtime(model).deploy(model, kind, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).remove(model, cache_dir)

    def warmup(self, model: str, cache_dir: str | None = None):
        runtime = self._runtime(model)
        warmup = getattr(runtime, "warmup", runtime.status)
        return warmup(model, cache_dir)

    def transcribe(self, model: str, audio_path: str, language: str | None = None, cache_dir: str | None = None):
        runtime = self._runtime(model)
        if _adapter_name(model) == "funasr":
            return runtime.transcribe(model, audio_path, language)
        return runtime.transcribe(model, audio_path, language, cache_dir)


__all__ = ["RoutedLocalAsrRuntime"]
