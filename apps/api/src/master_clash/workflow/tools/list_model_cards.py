"""
List Models Tool

Provides a tool to list available models for generation tasks.
"""

from dataclasses import asdict
from typing import Literal

from langchain.tools import BaseTool
from pydantic import BaseModel, Field

from clash_types.types import MODEL_CARDS


# Video render "model" info (not a real AI model, but follows same interface)
VIDEO_RENDER_INFO = {
    "id": "video-render",
    "name": "Video Render",
    "kind": "video_render",
    "description": "Render video-editor timeline to final video output",
    "params": {
        "fps": {"type": "int", "default": 30, "description": "Frames per second"},
        "compositionWidth": {"type": "int", "default": 1920, "description": "Output width"},
        "compositionHeight": {"type": "int", "default": 1080, "description": "Output height"},
    }
}


def create_list_models_tool() -> BaseTool:
    """Create list_models tool."""
    from langchain_core.tools import tool

    class ListModelsInput(BaseModel):
        kind: Literal[
            "image",
            "video",
            "audio",
            "image_gen",
            "video_gen",
            "audio_gen",
            "video_render",
        ] | None = Field(
            default=None,
            description=(
                "Optional kind to filter: image_gen, video_gen, audio_gen, video_render. "
                "Use video_render for video-editor timeline rendering."
            ),
        )

    @tool(args_schema=ListModelsInput)
    def list_models(kind: str | None = None) -> list[dict]:
        """List available models for generation. Use kind='video_render' for video-editor timeline rendering."""
        normalized_kind = None
        if kind:
            normalized_kind = kind.replace("_gen", "").replace("_render", "")

        # Get AI model cards
        cards = MODEL_CARDS
        if normalized_kind and normalized_kind not in ("video_render", "render"):
            cards = [card for card in MODEL_CARDS if card.kind == normalized_kind]

        result = [asdict(card) for card in cards]

        # Add video render info if requested or no filter
        if kind is None or kind in ("video_render", "render"):
            result.append(VIDEO_RENDER_INFO)

        return result

    return list_models
