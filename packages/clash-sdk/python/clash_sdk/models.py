"""Data models for action context and results.

Result protocol supports 0..N outputs per task.

    ActionResult.outputs = [AssetOutput(type='image', data=b'...'), ...]

Single-output actions can still use the convenience factories
(`ActionResult.image(...)`, etc.) — they wrap one `AssetOutput` in
`outputs`. Multi-output actions build the list explicitly via
`ActionResult.many([...])` or the bare constructor.

Server-side: the first output lands on the pending action-badge child
that was spawned at execute time; outputs 2..N spawn sibling asset
nodes positioned next to the first, sharing the same lineage edges.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Optional

Modality = Literal["image", "video", "audio", "text"]
ProviderApiShape = Literal[
    "fal",
    "openai-compatible",
    "openai-images",
    "google-vertex",
    "google-ai-studio",
    "replicate",
    "kie",
    "serverless-function",
    "http",
]


@dataclass
class ActionSecret:
    id: str
    label: str
    description: Optional[str] = None
    required: bool = True


@dataclass
class ProviderModelDefinition:
    """Model exposed by a custom/provider host.

    `id` is the Clash-facing model code. `upstream_model` is the
    provider-native endpoint/model id and defaults to `id` when omitted.
    """

    id: str
    name: str
    kind: Modality
    upstream_model: Optional[str] = None
    description: Optional[str] = None
    parameters: list[dict[str, Any]] = field(default_factory=list)
    default_params: dict[str, str | int | float | bool] = field(default_factory=dict)
    secret_id: Optional[str] = None
    endpoint: Optional[str] = None
    api_shape: Optional[ProviderApiShape] = None
    weight: Optional[float] = None


@dataclass
class ProviderDefinition:
    """Provider manifest that can back one or more model cards/routes."""

    id: str
    label: str
    api_shape: Optional[ProviderApiShape] = None
    base_url: Optional[str] = None
    endpoint: Optional[str] = None
    secrets: list[ActionSecret] = field(default_factory=list)
    models: list[ProviderModelDefinition] = field(default_factory=list)
    docs_url: Optional[str] = None


@dataclass
class ServerlessProviderDefinition(ProviderDefinition):
    """HTTPS function host shape for user-owned provider execution."""

    worker_url: str = ""
    api_shape: ProviderApiShape = "serverless-function"


@dataclass
class ServerlessProviderRequest:
    task_id: str
    node_id: str
    project_id: str
    provider_id: str
    model: dict[str, Any]
    prompt: str
    params: dict[str, Any] = field(default_factory=dict)
    refs: dict[str, list[str]] = field(default_factory=dict)
    secrets: dict[str, str] = field(default_factory=dict)


@dataclass
class ServerlessProviderResponse:
    outputs: list[AssetOutput] = field(default_factory=list)  # type: ignore[name-defined]
    type: Optional[Modality] = None
    url: Optional[str] = None
    mime_type: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None


def define_model(definition: ProviderModelDefinition) -> ProviderModelDefinition:
    return definition


def define_provider(definition: ProviderDefinition) -> ProviderDefinition:
    return definition


def define_serverless_provider(definition: ServerlessProviderDefinition) -> ServerlessProviderDefinition:
    return definition


@dataclass
class ActionContext:
    """Context passed to an action handler when a task is received."""

    task_id: str
    node_id: str
    project_id: str
    action_id: str
    prompt: str
    params: dict[str, Any] = field(default_factory=dict)
    model: dict[str, Any] | None = None
    # Decrypted variables for worker-runtime actions. Local-runtime tasks
    # currently receive an empty dict; local handlers should read provider
    # keys from their process environment.
    secrets: dict[str, str] = field(default_factory=dict)
    output_type: str = "image"
    # Reference asset R2 keys forwarded from NodeProcessor when the
    # action-badge had incoming asset edges. Empty if none attached.
    reference_image_r2_keys: list[str] = field(default_factory=list)
    reference_video_r2_keys: list[str] = field(default_factory=list)
    reference_audio_r2_keys: list[str] = field(default_factory=list)
    # Injected by ClashAgent at dispatch time. Handlers call
    # `await ctx.fetch_asset(r2_key)` to pull bytes for any reference.
    fetch_asset: Optional[Callable[[str], Awaitable[bytes]]] = None


@dataclass
class AssetOutput:
    """One asset produced by an action.

    For text outputs set `content` instead of `data` (skips R2 upload).
    `label` becomes the resulting node's display name; multi-output
    actions should set distinct labels ("tile 1/4", "tile 2/4", …) so
    siblings are tellable apart on the canvas.
    """

    type: Modality
    data: Optional[bytes] = None
    content: Optional[str] = None
    mime_type: Optional[str] = None
    label: Optional[str] = None


@dataclass
class ActionResult:
    """Result returned from an action handler — 0..N outputs.

    `description` lands on the primary output's node as
    `data.description`.
    """

    outputs: list[AssetOutput] = field(default_factory=list)
    description: Optional[str] = None

    @classmethod
    def image(
        cls,
        data: bytes,
        description: str | None = None,
        mime_type: str = "image/png",
        label: str | None = None,
    ) -> ActionResult:
        return cls(
            outputs=[AssetOutput(type="image", data=data, mime_type=mime_type, label=label)],
            description=description,
        )

    @classmethod
    def video(
        cls,
        data: bytes,
        description: str | None = None,
        mime_type: str = "video/mp4",
        label: str | None = None,
    ) -> ActionResult:
        return cls(
            outputs=[AssetOutput(type="video", data=data, mime_type=mime_type, label=label)],
            description=description,
        )

    @classmethod
    def audio(
        cls,
        data: bytes,
        description: str | None = None,
        mime_type: str = "audio/mpeg",
        label: str | None = None,
    ) -> ActionResult:
        return cls(
            outputs=[AssetOutput(type="audio", data=data, mime_type=mime_type, label=label)],
            description=description,
        )

    @classmethod
    def text(
        cls,
        content: str,
        description: str | None = None,
        label: str | None = None,
    ) -> ActionResult:
        return cls(
            outputs=[AssetOutput(type="text", content=content, label=label)],
            description=description,
        )

    @classmethod
    def many(cls, outputs: list[AssetOutput], description: str | None = None) -> ActionResult:
        return cls(outputs=outputs, description=description)
