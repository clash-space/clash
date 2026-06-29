from __future__ import annotations

import json
import sys

from . import handle_local_model_rpc
from .funasr import FunAsrLocalAsrRuntime


def main() -> int:
    adapter = sys.argv[1] if len(sys.argv) > 1 else "funasr"
    if adapter != "funasr":
        print(json.dumps({"ok": False, "error": f"unsupported local model adapter: {adapter}"}), flush=True)
        return 0
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("request must be a JSON object")
        response = handle_local_model_rpc(FunAsrLocalAsrRuntime(), payload)
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
