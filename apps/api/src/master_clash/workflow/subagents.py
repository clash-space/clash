"""SubAgent middleware for task delegation.

Inspired by deepagents' SubAgentMiddleware, this allows agents to delegate
tasks to specialized sub-agents with isolated context.
"""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, ModelRequest, ModelResponse
from langchain.tools import BaseTool, ToolRuntime
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable, RunnableConfig

logger = logging.getLogger(__name__)


@dataclass
class SubAgent:
    """Definition of a sub-agent for task delegation."""

    name: str
    description: str
    system_prompt: str
    tools: Sequence[BaseTool]
    model: BaseChatModel
    middleware: Sequence[AgentMiddleware] | None = None
    workspace_aware: bool = False  # Whether this agent should work within a specific group


@dataclass
class CompiledSubAgent:
    """Compiled sub-agent with executable graph."""

    name: str
    description: str
    graph: Runnable  # CompiledGraph is a Runnable


class SubAgentMiddleware(AgentMiddleware):
    """Middleware that enables task delegation to sub-agents.

    Similar to deepagents' SubAgentMiddleware, this creates a task_tool
    that allows the main agent to delegate work to specialized agents.
    """

    def __init__(
        self,
        subagents: Sequence[SubAgent],
        general_purpose_agent: bool = True,
    ):
        """Initialize sub-agent middleware.

        Args:
            subagents: List of sub-agent definitions or compiled agents
            general_purpose_agent: Whether to include a general-purpose delegator
        """
        self.subagents = subagents
        self.general_purpose_agent = general_purpose_agent
        self._compiled_agents: dict[str, Runnable] = {}
        # Keep tools as a list so middleware_tools iteration doesn't treat
        # a single BaseTool as an iterable of key/value tuples (pydantic __iter__).
        self.tools = [self._create_task_tool()]

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Add task delegation tool to the model request."""
        # Generate task tool

        # Add delegation-specific system prompt
        agent_names = [agent.name for agent in self.subagents]
        delegation_prompt = f"""
You can delegate tasks to specialized sub-agents: {", ".join(agent_names)}

Use the task_delegation tool to assign work:
- agent: Name of the sub-agent
- instruction: Clear task description
- context: Optional context data to pass

Sub-agents have isolated context and their own tools.
"""
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{delegation_prompt}"
        else:
            system_prompt = delegation_prompt

        return handler(request.override(system_message=SystemMessage(system_prompt)))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Add task delegation tool to the model request."""
        # Generate task tool

        # Add delegation-specific system prompt
        agent_names = [agent.name for agent in self.subagents]
        delegation_prompt = f"""
You can delegate tasks to specialized sub-agents: {", ".join(agent_names)}

Use the task_delegation tool to assign work:
- agent: Name of the sub-agent
- instruction: Clear task description
- context: Optional context data to pass

Sub-agents have isolated context and their own tools.
"""
        if request.system_prompt:
            system_prompt = f"{request.system_prompt}\n\n{delegation_prompt}"
        else:
            system_prompt = delegation_prompt

        return await handler(request.override(system_message=SystemMessage(system_prompt)))  # type: ignore

    def _create_task_tool(self) -> BaseTool:
        """Create the task delegation tool."""
        from langchain_core.tools import tool

        subagents = self.subagents

        @tool
        async def task_delegation(
            agent: str,
            instruction: str,
            runtime: ToolRuntime,
            config: RunnableConfig,
            workspace_group_id: str | None = None,
            context: dict[str, Any] | None = None,
        ) -> str:
            """Delegate a task to a specialized sub-agent and execute util the sub-agent finish.

            Args:
                agent: Name of the sub-agent to use
                instruction: Clear task description
                workspace_group_id: Optional group node ID to scope the agent's work
                config: Runnable config for callbacks


            Returns:
                Result from the sub-agent
            """
            try:
                logger.info(f"Task delegation started for agent: {agent}")
                logger.debug(f"Instruction: {instruction}")
                logger.debug(f"Workspace: {workspace_group_id}")
                logger.debug(f"Context: {context}")

                # Handle potential runtime type mismatch (e.g. if passed as dict by LLM)
                project_id = ""
                if hasattr(runtime, "state"):
                    project_id = runtime.state.get("project_id", "")
                elif isinstance(runtime, dict):
                    logger.warning("Runtime passed as dict, attempting to extract state")
                    project_id = runtime.get("state", {}).get("project_id", "")

                logger.debug(f"Project ID: {project_id}")

                # Find the target sub-agent
                target = None
                for sa in subagents:
                    if sa.name == agent:
                        target = sa
                        break

                if target is None:
                    available = ", ".join(sa.name for sa in subagents)
                    logger.warning(f"Unknown agent: {agent}. Available: {available}")
                    return f"Unknown agent: {agent}. Available: {available}"

                # Build sub-agent state
                msg_content = instruction
                if workspace_group_id:
                    msg_content = f"[Workspace: {workspace_group_id}]\n{instruction}"
                if context:
                    msg_content = f"{msg_content}\nContext: {context}"

                sub_state: dict[str, Any] = {
                    "messages": [HumanMessage(content=msg_content)],
                    "project_id": project_id,
                }

                # Add workspace scope to state if agent is workspace-aware
                if workspace_group_id and target.workspace_aware:
                    sub_state["workspace_group_id"] = workspace_group_id
                    logger.info(
                        f"[task_delegation] Added workspace_group_id to sub_state for {agent}: {workspace_group_id}"
                    )
                else:
                    logger.info(
                        f"[task_delegation] NOT adding workspace_group_id to sub_state. "
                        f"workspace_group_id={workspace_group_id}, workspace_aware={target.workspace_aware}"
                    )

                logger.info(f"[task_delegation] Final sub_state keys: {list(sub_state.keys())}")
                logger.info(f"[task_delegation] Final sub_state: {sub_state}")

                # Get or compile the sub-agent graph
                if isinstance(target, CompiledSubAgent):
                    graph = target.graph
                else:
                    # Compile SubAgent definition on first use

                    logger.info(f"Compiling sub-agent: {agent}")
                    graph = self._compile_subagent(target)

                # Invoke sub-agent with config (preserving loro_client in configurable)
                logger.info(f"Invoking sub-agent: {agent}")
                run_config: RunnableConfig = config.copy()
                if "configurable" not in run_config:
                    run_config["configurable"] = config.get("configurable", {})

                # CRITICAL FIX: Pass workspace_group_id via configurable as a reliable fallback
                # This ensures tools can access it even if state propagation fails
                if workspace_group_id and target.workspace_aware:
                    run_config["configurable"]["workspace_group_id"] = workspace_group_id
                    logger.info(
                        f"[task_delegation] Added workspace_group_id to run_config.configurable: {workspace_group_id}"
                    )

                if "metadata" in run_config:
                    run_config["metadata"].update({"agent_id": runtime.tool_call_id})
                result = await graph.ainvoke(sub_state, run_config)
                from langchain_core.load import dumps

                logger.info(dumps(result))
                messages = result.get("messages", [])

                if messages:
                    last_msg = messages[-1]
                    content = getattr(last_msg, "content", "")
                    logger.info(f"Sub-agent {agent} completed successfully {content}")
                    if isinstance(content, list):
                        content = content[-1]
                        if isinstance(content, str):
                            content = content.strip()
                        elif isinstance(content, dict) and "text" in content:
                            content = content["text"]
                    return f"{agent} completed: {content}"

                logger.info(f"Sub-agent {agent} completed with no output")
                return f"{agent} completed (no output)"

            except Exception as exc:
                logger.error(f"{agent} error: {exc}", exc_info=True)
                return f"{agent} error: {exc}"

        return task_delegation

    def _compile_subagent(self, subagent: SubAgent) -> Runnable:
        """Compile a SubAgent definition into an executable graph.

        Args:
            subagent: Sub-agent definition

        Returns:
            Compiled LangGraph
        """
        # Cache compiled agents
        if subagent.name in self._compiled_agents:
            return self._compiled_agents[subagent.name]

        # Import here to avoid circular dependency
        from langchain.agents import create_agent

        # Compile the sub-agent with its middleware
        graph = create_agent(
            model=subagent.model,
            tools=subagent.tools,
            system_prompt=subagent.system_prompt,
            middleware=list(subagent.middleware) if subagent.middleware else [],
        )

        self._compiled_agents[subagent.name] = graph
        return graph


def create_specialist_agents(
    model: BaseChatModel,
    canvas_middleware: AgentMiddleware,
    timeline_middleware: AgentMiddleware,
) -> Sequence[SubAgent]:
    """Create the four specialist agents for video creation.

    Args:
        model: Language model to use
        canvas_middleware: Canvas middleware for tools
        todo_middleware: Todo middleware for planning
        timeline_middleware: Timeline middleware for editing operations

    Returns:
        List of sub-agent definitions
    """

    script_writer = SubAgent(
        name="ScriptWriter",
        description="Professional script writer for creating story outlines",
        system_prompt="""You are a professional Script Writer.
Your goal is to create a compelling story.

**CRITICAL WORKSPACE RULES:**
- You are working inside a workspace group assigned by the Director.
- All your nodes will be AUTOMATICALLY placed in this workspace.
- **DO NOT create any group nodes** - the Director handles all group organization.
- Only create content nodes: text, image_gen, video_gen.

Tasks:
1. Create a text node with the Story Outline / Script.
2. Create text nodes for Character Bios if needed.

Use canvas tools to place content on the canvas.""",
        # tools=[list_node_info, read_node, create_node],
        tools=[],
        model=model,
        middleware=[canvas_middleware],
        workspace_aware=True,  # Auto-scope nodes to workspace
    )

    concept_artist = SubAgent(
        name="ConceptArtist",
        description="Concept artist for visualizing characters and scenes",
        system_prompt="""You are a Concept Artist.
Your goal is to visualize the characters and scenes from the script.

**CRITICAL WORKSPACE RULES:**
- You are working inside a workspace group assigned by the Director.
- All your nodes will be AUTOMATICALLY placed in this workspace.
- **DO NOT create any group nodes** - the Director handles all group organization.
- Only create content nodes: text, image_gen, video_gen.

Tasks:
1. Read the script from the canvas.
2. For each character or scene:
   - Create a PromptActionNode (type='image_gen') with:
     * label: Descriptive name (e.g., "Character: Alice")
     * content: Detailed visual description in Markdown
     * actionType: 'image-gen'
   - The node contains both the prompt and generation capability.
3. AFTER creating a generation node, you MUST wait for it to complete before using its result.
   - Use wait_for_generation to check status.
   - If status is 'generating', WAIT and then RETRY.
   - Repeat until status is 'completed'.""",
        # tools=[list_node_info, read_node, create_node, wait_for_task],
        tools=[],
        model=model,
        middleware=[canvas_middleware],
        workspace_aware=True,  # Auto-scope nodes to workspace
    )

    storyboard_designer = SubAgent(
        name="StoryboardDesigner",
        description="Storyboard designer for creating shot sequences",
        system_prompt="""You are a Storyboard Designer.
Your goal is to create a sequence of shots for the video.

**CRITICAL WORKSPACE RULES:**
- You are working inside a workspace group assigned by the Director.
- All your nodes will be AUTOMATICALLY placed in this workspace.
- **DO NOT create any group nodes** - the Director handles all group organization.
- Only create content nodes: text, image_gen, video_gen.

Tasks:
1. For each shot (Scene 1, Scene 2, etc.):
   - Create a PromptActionNode (type='image_gen' or 'video_gen') with:
     * label: Shot name (e.g., "Scene 1: Opening")
     * content: Detailed scene description in Markdown
     * actionType: 'image-gen' for stills, 'video-gen' for motion
   - The node combines prompt editing and generation.
2. ALWAYS wait for generation nodes to complete using wait_for_generation before creating dependent nodes.
   - If 'generating', retry after a short delay.""",
        # tools=[list_node_info, read_node, create_node, wait for_task],
        tools=[],
        model=model,
        middleware=[canvas_middleware],
        workspace_aware=True,  # Auto-scope nodes to workspace
    )

    editor = SubAgent(
        name="Editor",
        description="Video editor for assembling the final video from timeline nodes",
        system_prompt="""You are a Video Editor.
Your goal is to assemble the final video by maintaining a Timeline DSL within a video-editor node.

**CRITICAL REQUIREMENTS**:
1. You MUST receive a video-editor node ID from the director (passed in the instruction or context).
   - Look for patterns like "video-editor node: editor-abc123" or workspace_group_id containing the editor node.
   - If you don't have a node_id, ask the director to create a video-editor node first.

2. You have access to:
   - Node tools (read/write nodes on the canvas)
   - DSL tools (read_dsl, patch_dsl) - these work on video-editor nodes

Your Workflow:
1. Extract the video-editor node_id from the instruction or context.
2. Read the current timeline state: `read_dsl(node_id="editor-abc123")`
3. Search or read canvas nodes to find video/image assets to add to the timeline.
4. Modify the timeline using JSON Patch: `patch_dsl(node_id="editor-abc123", patch=[...])`
   - Use JSON Patch format (RFC 6902) for updates.
   - Example: [{"op": "add", "path": "/tracks/-", "value": {"id": "track-1", "items": [...]}}]
   - Do NOT overwrite the entire structure; use specific patches.

**Timeline DSL Structure**:
{
  "version": "1.0.0",
  "fps": 30,
  "compositionWidth": 1920,
  "compositionHeight": 1080,
  "durationInFrames": 0,
  "tracks": [
    {
      "id": "track-1",
      "items": [
        {
          "assetId": "asset-id-here",
          "from": 0,
          "durationInFrames": 150
        }
      ]
    }
  ]
}

The DSL within the video-editor node is the source of truth for the video structure.""",
        tools=[],
        model=model,
        middleware=[timeline_middleware, canvas_middleware],
        workspace_aware=False,  # Editor works globally with specific node_id
    )

    return [script_writer, concept_artist, storyboard_designer, editor]
