"""Data models for action context and results."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ActionContext:
    """Context passed to an action handler when a task is received."""

    task_id: str
    node_id: str
    project_id: str
    action_id: str
    prompt: str
    params: dict[str, Any] = field(default_factory=dict)
    output_type: str = "image"


@dataclass
class ActionResult:
    """Result returned from an action handler."""

    type: str  # "image" | "video" | "text"
    data: Optional[bytes] = None
    content: Optional[str] = None
    description: Optional[str] = None
    mime_type: Optional[str] = None

    @classmethod
    def image(
        cls,
        data: bytes,
        description: str | None = None,
        mime_type: str = "image/png",
    ) -> ActionResult:
        return cls(type="image", data=data, description=description, mime_type=mime_type)

    @classmethod
    def video(
        cls,
        data: bytes,
        description: str | None = None,
        mime_type: str = "video/mp4",
    ) -> ActionResult:
        return cls(type="video", data=data, description=description, mime_type=mime_type)

    @classmethod
    def text(cls, content: str, description: str | None = None) -> ActionResult:
        return cls(type="text", content=content, description=description)
