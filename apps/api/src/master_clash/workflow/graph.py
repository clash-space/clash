"""Agent graph factory inspired by deepagents' create_deep_agent.

This module provides the main API for creating agents with middleware.
"""

from collections.abc import Sequence
from typing import Any

from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool

from master_clash.workflow.backends import CanvasBackendProtocol, StateCanvasBackend
from master_clash.workflow.middleware import (
    AgentMiddleware,
    CanvasMiddleware,
)
from master_clash.workflow.subagents import SubAgent, SubAgentMiddleware


def create_agent_with_middleware(
    model: BaseChatModel,
    tools: Sequence[BaseTool],
    system_prompt: str | None = None,
    middleware: Sequence[AgentMiddleware] | None = None,
    backend: CanvasBackendProtocol | None = None,
    subagents: Sequence[SubAgent] | None = None,
    checkpointer: Any | None = None,
) -> Runnable:
    """Create an agent with middleware stack.

    This is the main factory function, inspired by deepagents' create_deep_agent.

    Args:
        model: Language model to use
        tools: Base tools (middleware will add more)
        system_prompt: Optional system prompt
        middleware: Custom middleware stack (if None, uses defaults)
        backend: Canvas backend (defaults to StateCanvasBackend)
        subagents: Sub-agents for delegation
        checkpointer: Optional persistence checkpointer

    Returns:
        Compiled LangGraph agent
    """
    # Default middleware stack
    if middleware is None:
        middleware = _create_default_middleware(backend, subagents)

    # Collect all tools from middleware

    return create_agent(
        model=model,
        tools=tools,
        middleware=middleware,
        system_prompt=system_prompt,
        checkpointer=checkpointer
    )


def _create_default_middleware(
    backend: CanvasBackendProtocol | None,
    subagents: Sequence[SubAgent] | None,
) -> Sequence[AgentMiddleware]:
    """Create default middleware stack.

    Args:
        backend: Canvas backend
        subagents: Sub-agents for delegation

    Returns:
        Default middleware stack
    """
    backend = backend or StateCanvasBackend()

    middleware: list[AgentMiddleware] = [
        CanvasMiddleware(backend=backend),
    ]

    if subagents:
        middleware.append(SubAgentMiddleware(subagents=subagents))

    return middleware


def create_supervisor_agent(
    model: BaseChatModel,
    subagents: Sequence[SubAgent],
    system_prompt: str | None = None,
    backend: CanvasBackendProtocol | None = None,
    checkpointer: Any | None = None,
) -> Runnable:
    """Create a supervisor agent that delegates to specialists.

    Args:
        model: Language model to use
        subagents: Specialist sub-agents
        system_prompt: Optional system prompt
        backend: Canvas backend
        checkpointer: Optional persistence checkpointer

    Returns:
        Compiled supervisor agent
    """

    # Create supervisor-specific tools
    backend = backend or StateCanvasBackend()


    if system_prompt is None:
        agent_names = [sa.name for sa in subagents]
        system_prompt = f"""You are the Supervisor. You coordinate work between specialized agents.

Available agents: {', '.join(agent_names)}

## CRITICAL: Group Management Rules

**ONLY YOU (the Supervisor/Director) can create groups.** Subagents are PROHIBITED from creating groups.

When delegating tasks:
1. **ALWAYS create a group FIRST** before delegating
2. **ALWAYS pass `workspace_group_id`** to the subagent via `task_delegation`
3. Subagents will automatically place all their nodes inside the assigned workspace

This prevents duplicate group creation and keeps the canvas organized.

## Your Workflow:

1. **Create Workspace Group FIRST**:
   - Use `create_node(node_type="group", ...)` to create a workspace
   - Get the returned group ID (e.g., "group-abc-123")

2. **Then Delegate Tasks** with the workspace_group_id:
   - Use `task_delegation(agent="...", instruction="...", workspace_group_id="group-abc-123")`
   - The subagent's nodes will automatically be placed in this group
   - **NEVER delegate without providing workspace_group_id** (except for Editor)

3. **Simple Tasks**: You can also handle simple tasks directly using tools

## Video Editor Workflow:

When delegating to the **Editor** agent to assemble a video timeline:

1. **Create a video-editor node** first using `create_generation_node`:
   ```
   create_generation_node(
     node_type="video_editor",
     payload={{"label": "Final Video Timeline"}}
   )
   → Returns: editor-abc-123
   ```

2. **Pass the node_id to the Editor** agent in the instruction:
   ```
   task_delegation(
     agent="Editor",
     instruction="Assemble the video timeline using video-editor node: editor-abc-123. Add items from the generated assets.",
     context={{"editor_node_id": "editor-abc-123"}}
   )
   ```

3. **Trigger rendering** when ready:
   ```
   run_generation_node(node_id="editor-abc-123")
   ```

**CRITICAL**: The Editor agent REQUIRES a video-editor node_id to work. Always create the node first and pass it in the instruction.

## Example:

User: "Create a character design for a space explorer"

Step 1: Create workspace
create_node(node_type="group", payload={{"label": "Space Explorer Character", "description": "Character design workspace"}})
→ Returns: group-abc-123

Step 2: Delegate to specialist
task_delegation(
  agent="ConceptArtist",
  instruction="Design a space explorer character with futuristic suit",
  workspace_group_id="group-abc-123"
)

All the agent's work (prompts, images) will be organized inside that group!

## Using Selected Nodes

When you see [SELECTED NODE IDS] in the message, these are node IDs the user has selected on the canvas.
Use `read_node` tool to get the full details (type, src, label, etc.) of these nodes.
The user wants you to work with these specific nodes - always read them first to understand the context.
"""

    # Create supervisor with SubAgentMiddleware + CanvasMiddleware
    return create_agent_with_middleware(
        model=model,
        tools=[],
        system_prompt=system_prompt,
        backend=backend,
        subagents=subagents,
        checkpointer=checkpointer,
    )
