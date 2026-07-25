"""Local model SDK contracts.

The host process should depend on these small runtime contracts, not on a
specific model package. Concrete adapters such as FunASR live behind the same
status/deploy/transcribe shape and can be called over JSON-RPC by JS hosts.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal, Protocol

LocalModelKind = Literal["asr", "tts", "image", "video", "audio", "text"]


@dataclass
class LocalModelStatus:
    available: bool
    message: str | None = None


@dataclass
class LocalAsrWord:
    id: str
    text: str
    start_ms: int
    end_ms: int
    confidence: float | None = None
    speaker_id: str | None = None


@dataclass
class LocalAsrSegment:
    id: str
    text: str
    start_ms: int
    end_ms: int
    word_ids: list[str]
    speaker_id: str | None = None


@dataclass
class LocalAsrTranscription:
    text: str
    backend_id: str
    model_id: str
    duration_ms: int
    words: list[LocalAsrWord]
    segments: list[LocalAsrSegment]
    language: str | None = None
    schema_version: int = field(default=1, init=False)
    kind: str = field(default="clash.asr.timed-transcript", init=False)
    timebase: str = field(default="milliseconds", init=False)
    alignment: str = field(default="word", init=False)


@dataclass
class LocalTtsSynthesis:
    backend_id: str
    model_id: str
    sample_rate: int
    duration_ms: int
    output_path: str
    voice_id: str | None = None
    schema_version: int = field(default=1, init=False)
    kind: str = field(default="clash.tts.audio", init=False)
    format: str = field(default="wav", init=False)


class LocalAsrRuntime(Protocol):
    def status(self, model: str, cache_dir: str | None = None) -> LocalModelStatus:
        ...

    def deploy(
        self,
        model: str,
        kind: LocalModelKind = "asr",
        cache_dir: str | None = None,
    ) -> None:
        ...

    def transcribe(
        self,
        model: str,
        audio_path: str,
        language: str | None = None,
        cache_dir: str | None = None,
    ) -> LocalAsrTranscription:
        ...


def handle_local_model_rpc(runtime: Any, payload: dict[str, Any]) -> dict[str, Any]:
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
        cache_dir = _optional_string_param(params.get("cache_dir"))
        if method == "status":
            status_args = {"model": _string_param(params, "model")}
            if cache_dir:
                status_args["cache_dir"] = cache_dir
            result = runtime.status(**status_args)
        elif method == "deploy":
            deploy_args = {
                "model": _string_param(params, "model"),
                "kind": _kind_param(params.get("kind", "asr")),
            }
            if cache_dir:
                deploy_args["cache_dir"] = cache_dir
            result = runtime.deploy(**deploy_args)
        elif method == "remove":
            result = runtime.remove(
                model=_string_param(params, "model"),
                cache_dir=cache_dir,
            )
        elif method == "transcribe":
            transcribe_args = {
                "model": _string_param(params, "model"),
                "audio_path": _string_param(params, "audio_path"),
                "language": _optional_string_param(params.get("language")),
            }
            if cache_dir:
                transcribe_args["cache_dir"] = cache_dir
            result = runtime.transcribe(**transcribe_args)
        elif method == "synthesize":
            result = runtime.synthesize(
                model=_string_param(params, "model"),
                text=_string_param(params, "text"),
                output_path=_string_param(params, "output_path"),
                cache_dir=cache_dir,
                voice=_optional_string_param(params.get("voice")),
                speed=_optional_positive_number_param(params.get("speed"), "speed"),
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


def _optional_positive_number_param(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{name} must be a positive number")
    return float(value)


def _kind_param(value: Any) -> LocalModelKind:
    if value in ("asr", "tts", "image", "video", "audio", "text"):
        return value
    raise ValueError("kind must be asr, tts, image, video, audio, or text")


def _camel_case(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _to_json_value(value: Any, *, top_level: bool = True) -> Any:
    if value is None:
        return {} if top_level else None
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        return {
            _camel_case(str(key)): _to_json_value(item, top_level=False)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, (list, tuple)):
        return [_to_json_value(item, top_level=False) for item in value]
    if isinstance(value, (str, int, float, bool)):
        return value
    raise ValueError(f"unsupported local model result: {type(value).__name__}")


__all__ = [
    "LocalAsrRuntime",
    "LocalAsrSegment",
    "LocalAsrTranscription",
    "LocalAsrWord",
    "LocalModelKind",
    "LocalModelStatus",
    "LocalTtsSynthesis",
    "handle_local_model_rpc",
]
