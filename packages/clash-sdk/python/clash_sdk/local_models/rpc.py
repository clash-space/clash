from __future__ import annotations

import json
import sys

from . import handle_local_model_rpc
from .asr import RoutedLocalAsrRuntime
from .funasr import FunAsrLocalAsrRuntime
from .kokoro import KokoroLocalTtsRuntime
from .parakeet import ParakeetLocalAsrRuntime
from .piper import PiperLocalTtsRuntime
from .tts import RoutedLocalTtsRuntime
from .vibevoice import VibeVoiceLocalAsrRuntime
from .whisper import WhisperLocalAsrRuntime


def main() -> int:
    adapter = sys.argv[1] if len(sys.argv) > 1 else "asr"
    runtimes = {
        "asr": RoutedLocalAsrRuntime,
        "funasr": FunAsrLocalAsrRuntime,
        "whisper": WhisperLocalAsrRuntime,
        "parakeet": ParakeetLocalAsrRuntime,
        "vibevoice": VibeVoiceLocalAsrRuntime,
        "tts": RoutedLocalTtsRuntime,
        "piper": PiperLocalTtsRuntime,
        "kokoro": KokoroLocalTtsRuntime,
    }
    if adapter not in runtimes:
        print(json.dumps({"ok": False, "error": f"unsupported local model adapter: {adapter}"}), flush=True)
        return 0
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("request must be a JSON object")
        runtime = runtimes[adapter]()
        response = handle_local_model_rpc(runtime, payload)
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
