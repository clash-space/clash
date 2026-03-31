"""Decorator for defining custom canvas actions."""

from __future__ import annotations

from typing import Any, Callable, Awaitable
from .models import ActionContext, ActionResult


class ActionDefinition:
    """Stores metadata about a registered action and its handler."""

    def __init__(
        self,
        handler: Callable[[ActionContext], Awaitable[ActionResult]],
        id: str,
        name: str,
        description: str = "",
        output_type: str = "image",
        parameters: list[dict[str, Any]] | None = None,
        icon: str = "",
        color: str = "",
    ):
        self.handler = handler
        self.id = id
        self.name = name
        self.description = description
        self.output_type = output_type
        self.parameters = parameters or []
        self.icon = icon
        self.color = color

    def to_manifest(self) -> dict[str, Any]:
        """Convert to the manifest format expected by ProjectRoom."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "outputType": self.output_type,
            "icon": self.icon,
            "color": self.color,
        }


def action(
    id: str,
    name: str,
    output_type: str = "image",
    description: str = "",
    parameters: list[dict[str, Any]] | None = None,
    icon: str = "",
    color: str = "",
) -> Callable:
    """
    Decorator to register a function as a custom canvas action.

    Example:
        @action(id="upscale", name="Upscale Image", output_type="image")
        async def upscale(ctx: ActionContext) -> ActionResult:
            ...
    """

    def decorator(
        func: Callable[[ActionContext], Awaitable[ActionResult]],
    ) -> ActionDefinition:
        return ActionDefinition(
            handler=func,
            id=id,
            name=name,
            description=description,
            output_type=output_type,
            parameters=parameters,
            icon=icon,
            color=color,
        )

    return decorator
