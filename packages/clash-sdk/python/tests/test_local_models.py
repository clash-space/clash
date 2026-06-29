import sys
from pathlib import Path

SDK_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SDK_DIR))

from clash_sdk.local_models import (
    LocalAsrTranscription,
    LocalModelStatus,
    handle_local_model_rpc,
)


class FakeAsrRuntime:
    def __init__(self):
        self.calls = []

    def status(self, model: str):
        self.calls.append(("status", model))
        return LocalModelStatus(available=True)

    def deploy(self, model: str, kind: str = "asr"):
        self.calls.append(("deploy", model, kind))
        return None

    def transcribe(self, model: str, audio_path: str, language: str | None = None):
        self.calls.append(("transcribe", model, audio_path, language))
        return LocalAsrTranscription(text="你好 local")


def test_local_model_rpc_dispatches_to_runtime_contract():
    runtime = FakeAsrRuntime()

    assert handle_local_model_rpc(runtime, {"method": "status", "params": {"model": "iic/SenseVoiceSmall"}}) == {
        "ok": True,
        "result": {"available": True},
    }
    assert handle_local_model_rpc(runtime, {"method": "deploy", "params": {"model": "iic/SenseVoiceSmall", "kind": "asr"}}) == {
        "ok": True,
        "result": {},
    }
    assert handle_local_model_rpc(
        runtime,
        {
            "method": "transcribe",
            "params": {"model": "iic/SenseVoiceSmall", "audio_path": "/tmp/input.webm", "language": "zh"},
        },
    ) == {
        "ok": True,
        "result": {"text": "你好 local"},
    }

    assert runtime.calls == [
        ("status", "iic/SenseVoiceSmall"),
        ("deploy", "iic/SenseVoiceSmall", "asr"),
        ("transcribe", "iic/SenseVoiceSmall", "/tmp/input.webm", "zh"),
    ]


def test_local_model_rpc_returns_structured_errors():
    class BrokenAsrRuntime(FakeAsrRuntime):
        def status(self, model: str):
            raise RuntimeError("missing funasr")

    assert handle_local_model_rpc(BrokenAsrRuntime(), {"method": "status", "params": {"model": "x"}}) == {
        "ok": False,
        "error": "missing funasr",
    }
