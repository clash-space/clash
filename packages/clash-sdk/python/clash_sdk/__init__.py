"""
Clash SDK — Register and run local code as canvas actions.

Usage:
    from clash_sdk import action, ActionContext, ActionResult, run

    @action(
        id="style-transfer",
        name="Style Transfer",
        output_type="image",
        parameters=[
            {"id": "style", "type": "select", "label": "Style",
             "options": [{"label": "Oil Painting", "value": "oil"},
                         {"label": "Watercolor", "value": "watercolor"}]},
        ],
    )
    async def style_transfer(ctx: ActionContext) -> ActionResult:
        # Your local code here
        result_bytes = my_model(ctx.prompt, ctx.params["style"])
        return ActionResult.image(result_bytes, description="Styled image")

    if __name__ == "__main__":
        run(server_url="ws://localhost:8789", project_id="my-project", token="...")
"""

from .decorators import action
from .models import (
    ActionContext,
    ActionResult,
    ActionSecret,
    AssetOutput,
    ProviderDefinition,
    ProviderModelDefinition,
    ServerlessProviderDefinition,
    ServerlessProviderRequest,
    ServerlessProviderResponse,
    define_model,
    define_provider,
    define_serverless_provider,
)


def run(*args, **kwargs):
    from .agent import run as _run

    return _run(*args, **kwargs)


def __getattr__(name: str):
    if name == "ClashAgent":
        from .agent import ClashAgent

        return ClashAgent
    raise AttributeError(name)

__all__ = [
    "action",
    "ActionContext",
    "ActionResult",
    "ActionSecret",
    "AssetOutput",
    "ProviderDefinition",
    "ProviderModelDefinition",
    "ServerlessProviderDefinition",
    "ServerlessProviderRequest",
    "ServerlessProviderResponse",
    "define_model",
    "define_provider",
    "define_serverless_provider",
    "ClashAgent",
    "run",
]
