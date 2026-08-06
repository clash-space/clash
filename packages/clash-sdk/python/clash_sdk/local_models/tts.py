from __future__ import annotations

from typing import Any


class RoutedLocalTtsRuntime:
    """Routes local TTS models to Kokoro or the lightweight Piper fallback."""

    def __init__(self, *, piper_runtime: Any | None = None, kokoro_runtime: Any | None = None):
        self._runtimes = {
            name: runtime
            for name, runtime in {
                "piper": piper_runtime,
                "kokoro": kokoro_runtime,
            }.items()
            if runtime is not None
        }

    def _named_runtime(self, name: str) -> Any:
        cached = self._runtimes.get(name)
        if cached is not None:
            return cached
        if name == "kokoro":
            from .kokoro import KokoroLocalTtsRuntime

            runtime = KokoroLocalTtsRuntime()
        else:
            from .piper import PiperLocalTtsRuntime

            runtime = PiperLocalTtsRuntime()
        self._runtimes[name] = runtime
        return runtime

    def _runtime(self, model: str) -> Any:
        return self._named_runtime("kokoro" if "kokoro" in model.lower() else "piper")

    def status(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).status(model, cache_dir)

    def deploy(self, model: str, kind: str = "tts", cache_dir: str | None = None):
        return self._runtime(model).deploy(model, kind, cache_dir)

    def remove(self, model: str, cache_dir: str | None = None):
        return self._runtime(model).remove(model, cache_dir)

    def warmup(self, model: str, cache_dir: str | None = None):
        runtime = self._runtime(model)
        warmup = getattr(runtime, "warmup", runtime.status)
        return warmup(model, cache_dir)

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
