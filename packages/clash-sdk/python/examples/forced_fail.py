"""
Forced-fail action — always raises. Used to exercise the failure path
of the multi-output protocol end-to-end:

  agent raises → ActionResult never returned → SDK sends
    {type: "complete_custom_task", status: "failed", result: {error,
    assets: []}}
  → ProjectRoom marks primary node `status: 'failed'` with the error
    string, deletes the tasksMap entry, spawns NO sibling nodes.

Run alongside grid_split or alone:
  CLASH_PROJECT_ID=<id> CLASH_API_KEY=<token> python examples/forced_fail.py
"""

from __future__ import annotations

import os
import asyncio

from clash_sdk import action, ActionContext, ActionResult, run


@action(
    id="forced-fail",
    name="Forced Fail",
    description="Always raises. For testing the failure path of custom actions.",
    output_type="image",
    prompt_modalities=["text"],
)
async def forced_fail(ctx: ActionContext) -> ActionResult:
    raise RuntimeError("intentional failure for end-to-end testing")


if __name__ == "__main__":
    run(
        server_url=os.environ.get("CLASH_SERVER_URL", "ws://localhost:8789"),
        project_id=os.environ.get("CLASH_PROJECT_ID", ""),
        token=os.environ.get("CLASH_API_KEY", ""),
        actions=[forced_fail],
    )
