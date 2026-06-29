"""Local model SDK contracts.

The host process should depend on these small runtime contracts, not on a
specific model package. Concrete adapters such as FunASR live behind the same
status/deploy/transcribe shape and can be called over JSON-RPC by JS hosts.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from typing import Any, Literal, Protocol

LocalModelKind = Literal["asr", "image", "video", "audio", "text"]


@dataclass
class LocalModelStatus:
    available: bool
    message: str | None = None


@dataclass
class LocalAsrTranscription:
    text: str


class LocalAsrRuntime(Protocol):
    def status(self, model: str) -> LocalModelStatus:
        ...

    def deploy(self, model: str, kind: LocalModelKind = "asr") -> None:
        ...

    def transcribe(self, model: str, audio_path: str, language: str | None = None) -> LocalAsrTranscription:
        ...


def handle_local_model_rpc(runtime: LocalAsrRuntime, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch one JSON-RPC-like request to a local model runtime.

    The wire shape is intentionally tiny because JS/Electron hosts call it
    through a short-lived Python subprocess:
    `{ "method": "status"|"deploy"|"transcribe", "params": {...} }`.
    """

    try:
        method = payload.get("method")
        params = payload.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        if method == "status":
            result = runtime.status(model=_string_param(params, "model"))
        elif method == "deploy":
            result = runtime.deploy(
                model=_string_param(params, "model"),
                kind=_kind_param(params.get("kind", "asr")),
            )
        elif method == "transcribe":
            result = runtime.transcribe(
                model=_string_param(params, "model"),
                audio_path=_string_param(params, "audio_path"),
                language=_optional_string_param(params.get("language")),
            )
        else:
            raise ValueError(f"unsupported local model method: {method}")
        return {"ok": True, "result": _to_json_value(result)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _string_param(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def _optional_string_param(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _kind_param(value: Any) -> LocalModelKind:
    if value in ("asr", "image", "video", "audio", "text"):
        return value
    raise ValueError("kind must be asr, image, video, audio, or text")


def _to_json_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if is_dataclass(value):
        return {key: item for key, item in asdict(value).items() if item is not None}
    if isinstance(value, dict):
        return value
    raise ValueError(f"unsupported local model result: {type(value).__name__}")


__all__ = [
    "LocalAsrRuntime",
    "LocalAsrTranscription",
    "LocalModelKind",
    "LocalModelStatus",
    "handle_local_model_rpc",
]
