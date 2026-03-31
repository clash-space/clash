"""
Example: Simple echo action that returns the prompt as text.

Usage:
    python examples/echo_action.py

Environment variables:
    CLASH_SERVER_URL  - WebSocket URL (default: ws://localhost:8789)
    CLASH_PROJECT_ID  - Project ID to connect to
    CLASH_API_KEY     - Authentication token
"""

import os

from clash_sdk import action, ActionContext, ActionResult, run


@action(
    id="echo",
    name="Echo",
    description="Returns the prompt text back as a text node",
    output_type="text",
)
async def echo(ctx: ActionContext) -> ActionResult:
    return ActionResult.text(
        content=f"Echo: {ctx.prompt}",
        description="Echoed prompt text",
    )


@action(
    id="word-count",
    name="Word Count",
    description="Counts words in the prompt",
    output_type="text",
    parameters=[
        {
            "id": "include_chars",
            "label": "Include character count",
            "type": "boolean",
            "defaultValue": False,
        }
    ],
)
async def word_count(ctx: ActionContext) -> ActionResult:
    words = len(ctx.prompt.split())
    text = f"Word count: {words}"
    if ctx.params.get("include_chars"):
        text += f"\nCharacter count: {len(ctx.prompt)}"
    return ActionResult.text(content=text)


if __name__ == "__main__":
    run(
        server_url=os.environ.get("CLASH_SERVER_URL", "ws://localhost:8789"),
        project_id=os.environ.get("CLASH_PROJECT_ID", ""),
        token=os.environ.get("CLASH_API_KEY", ""),
        actions=[echo, word_count],
    )
