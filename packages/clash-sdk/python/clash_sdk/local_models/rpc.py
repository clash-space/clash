from __future__ import annotations

import importlib
import json
import sys
from typing import Any

from . import handle_local_model_rpc


_RUNTIME_TYPES = {
    "asr": ("asr", "RoutedLocalAsrRuntime"),
    "funasr": ("funasr", "FunAsrLocalAsrRuntime"),
    "whisper": ("whisper", "WhisperLocalAsrRuntime"),
    "parakeet": ("parakeet", "ParakeetLocalAsrRuntime"),
    "vibevoice": ("vibevoice", "VibeVoiceLocalAsrRuntime"),
    "tts": ("tts", "RoutedLocalTtsRuntime"),
    "piper": ("piper", "PiperLocalTtsRuntime"),
    "kokoro": ("kokoro", "KokoroLocalTtsRuntime"),
}


class LazyLocalModelRuntimeRouter:
    """Lazily import and retain every Python-backed local model adapter."""

    def __init__(self) -> None:
        self._runtimes: dict[str, Any] = {}

    def runtime(self, adapter: str) -> Any:
        if adapter not in _RUNTIME_TYPES:
            raise ValueError(f"unsupported local model adapter: {adapter}")
        runtime = self._runtimes.get(adapter)
        if runtime is not None:
            return runtime
        module_name, class_name = _RUNTIME_TYPES[adapter]
        runtime_type = globals().get(class_name)
        if runtime_type is None:
            module = importlib.import_module(f"{__package__}.{module_name}")
            runtime_type = getattr(module, class_name)
        runtime = runtime_type()
        self._runtimes[adapter] = runtime
        return runtime


def _request_adapter(payload: dict[str, Any], fixed_adapter: str | None) -> str:
    if fixed_adapter:
        return fixed_adapter
    adapter = payload.get("adapter")
    if not isinstance(adapter, str) or not adapter.strip():
        raise ValueError("adapter is required for the local model router")
    return adapter.strip()


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "router"
    fixed_adapter = None if mode == "router" else mode
    if fixed_adapter and fixed_adapter not in _RUNTIME_TYPES:
        print(json.dumps({"ok": False, "error": f"unsupported local model adapter: {fixed_adapter}"}), flush=True)
        return 0
    router = LazyLocalModelRuntimeRouter()
    for line in sys.stdin:
        request_id = None
        try:
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError("request must be a JSON object")
            request_id = payload.get("id")
            runtime = router.runtime(_request_adapter(payload, fixed_adapter))
            response = handle_local_model_rpc(runtime, payload)
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
            if isinstance(request_id, str) and request_id:
                response = {"id": request_id, **response}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
