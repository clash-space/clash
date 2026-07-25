from __future__ import annotations

from typing import Any

from .kokoro import KokoroLocalTtsRuntime
from .piper import PiperLocalTtsRuntime


class RoutedLocalTtsRuntime:
    """Routes local TTS models to Kokoro or the lightweight Piper fallback."""

    def __init__(self, *, piper_runtime: Any | None = None, kokoro_runtime: Any | None = None):
        self.piper_runtime = piper_runtime or PiperLocalTtsRuntime()
        self.kokoro_runtime = kokoro_runtime or KokoroLocalTtsRuntime()

    def _runtime(self, model: str) -> Any:
        return self.kokoro_runtime if "kokoro" in model.lower() else self.piper_runtime

    def status(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).status(model, cache_dir)

    def deploy(self, model: str, kind: str = "tts", cache_dir: str | None = None):
        return self._runtime(model).deploy(model, kind, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).remove(model, cache_dir)

    def synthesize(
        self,
        model: str,
        text: str,
        output_path: str,
        cache_dir: str | None = None,
        voice: str | None = None,
        speed: float | None = None,
    ):
        return self._runtime(model).synthesize(model, text, output_path, cache_dir, voice, speed)


__all__ = ["RoutedLocalTtsRuntime"]
