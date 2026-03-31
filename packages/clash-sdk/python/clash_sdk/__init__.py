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
from .models import ActionContext, ActionResult
from .agent import ClashAgent, run

__all__ = ["action", "ActionContext", "ActionResult", "ClashAgent", "run"]
