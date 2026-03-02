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
    additional_middleware: Sequence[AgentMiddleware] | None = None,
) -> Runnable:
    """Create a supervisor agent that delegates to specialists.

    Args:
        model: Language model to use.
        subagents: Specialist sub-agents.
        system_prompt: Optional system prompt.
        backend: Canvas backend.
        checkpointer: Optional persistence checkpointer.
        additional_middleware: Additional middleware to apply (e.g., SkillsMiddleware).

    Returns:
        Compiled supervisor agent.
    """
    backend = backend or StateCanvasBackend()

    if system_prompt is None:
        agent_names = [sa.name for sa in subagents]
        system_prompt = f"""You are the MasterClash. You handle creative tasks directly using your skills and delegate editing tasks to specialists.

Available agents for delegation: {', '.join(agent_names)}

## Your Capabilities

You have built-in skills for creative work:
- **scriptwriting**: Create compelling story outlines and scripts
- **concept-art**: Visualize characters and scenes through AI image generation
- **storyboarding**: Create shot sequences and visual flow
- **Video category best practices**: product-ecommerce, tutorial-explainer, story-narrative, social-media

Use these skills directly - no delegation needed for creative tasks!

## CRITICAL: Group Management Rules

**ONLY YOU can create groups.** When organizing work:
1. **Create a group FIRST** to organize related content
2. Place your nodes inside that group

## Your Workflow:

1. **Create Workspace Group** for organized projects:
   - Use `create_node(node_type="group", ...)` to create a workspace
   - Get the returned group ID (e.g., "group-abc-123")

2. **Handle Creative Tasks Directly**:
   - Use your scriptwriting skill to create scripts and outlines
   - Use concept-art skill for character/scene visualization
   - Use storyboarding skill for shot sequences
   - Create nodes directly on the canvas

3. **Delegate to Editor** for timeline assembly:
   - Only the Editor agent handles timeline DSL operations
   - See Video Editor Workflow below

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

Step 2: Use your concept-art skill directly
- Create an image_gen node with the character design prompt
- Follow the prompt engineering best practices from your skill
- No delegation needed!

## Using Selected Nodes

When you see [SELECTED NODE IDS] in the message, these are node IDs the user has selected on the canvas.
Use `read_node` tool to get the full details (type, src, label, etc.) of these nodes.
The user wants you to work with these specific nodes - always read them first to understand the context.
"""

    # Build middleware stack:
    # 1. Additional middleware (e.g., SkillsMiddleware, CanvasMiddleware from caller)
    # 2. SubAgentMiddleware for delegation to specialists
    middleware_stack: list[AgentMiddleware] = []

    if additional_middleware:
        middleware_stack.extend(additional_middleware)

    # Add SubAgentMiddleware for Editor delegation
    middleware_stack.append(SubAgentMiddleware(subagents=subagents))

    # Create supervisor with explicit middleware stack
    return create_agent(
        model=model,
        tools=[],
        system_prompt=system_prompt,
        middleware=middleware_stack,
        checkpointer=checkpointer,
    )
